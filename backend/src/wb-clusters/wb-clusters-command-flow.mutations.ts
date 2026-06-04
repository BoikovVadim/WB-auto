import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";

import { invalidateProductAdvertisingSheetCaches } from "./wb-clusters-read-flow.snapshot-read";

type WbClustersService = any;

export async function applyProductClusterAction(
  self: WbClustersService,
  nmId: number,
  advertId: number,
  action: string,
  clusterNames: string[],
  initiatedBy: "user" | "automation" = "user",
) {
  if (!self.wbClustersRepository.isConfigured()) {
    throw new ServiceUnavailableException(
      "PostgreSQL не настроен. Невозможно изменить статус кластера.",
    );
  }

  if (self.wbRuntimeConfigService.getPromotionTokenSource() === "missing") {
    throw new ServiceUnavailableException(
      "Не настроен WB Promotion API token. Невозможно изменить статус кластера.",
    );
  }

  await self.wbClustersRepository.ensureSchema();

  const uniqueClusterNames = Array.from(
    new Map(
      clusterNames
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => [self.normalizeAdvertisingText(item), item]),
    ).values(),
  );

  if (uniqueClusterNames.length === 0) {
    throw new BadRequestException("Не переданы кластеры для изменения.");
  }

  const mutationContext = await self.wbClustersRepository.getProductAdvertisingMutationContext({
    nmId,
    advertId,
    normalizedClusterNames: uniqueClusterNames,
  });
  const campaign = mutationContext.campaign;
  if (!campaign) {
    throw new BadRequestException(`Не найдена рекламная кампания ${advertId} для товара ${nmId}.`);
  }

  const editableClusters = new Map();
  for (const cluster of mutationContext.clusters) {
    editableClusters.set(self.normalizeAdvertisingText(cluster.clusterName), cluster);
    editableClusters.set(self.normalizeAdvertisingText(cluster.canonicalNormQuery), cluster);
  }

  const canonicalInput = uniqueClusterNames.map((clusterName) => {
    const cluster = editableClusters.get(self.normalizeAdvertisingText(clusterName)) ?? null;
    if (!cluster) {
      throw new BadRequestException(
        `Кластер «${clusterName}» сейчас недоступен для изменения.`,
      );
    }

    return {
      clusterName: cluster.canonicalNormQuery,
      desiredIsActive: action === "include",
    };
  });

  const appliedAt = new Date().toISOString();
  const syncRunId = await self.wbClustersRepository.createSyncRun("manual");

  await self.wbClustersRepository.upsertClusterActions(
    canonicalInput.map((item) => ({
      advert_id: advertId,
      nm_id: nmId,
      norm_query: item.clusterName,
      desired_is_active: item.desiredIsActive,
      action_sync_status: "queued",
      action_retry_at: null,
      action_last_error: null,
    })),
  );

  const queuedJob = await self.wbClustersRepository.createClusterActionJob({
    advertId,
    nmId,
    actions: canonicalInput,
  });

  await self.wbClustersRepository.saveRawArchive({
    syncRunId,
    archiveType: "normquery-minus-queued",
    advertId,
    nmId,
    payload: {
      direction: "internal",
      entityType: "cluster-action",
      requestIntent: "queue-manual-cluster-action",
      queuedAt: queuedJob.queuedAt,
      jobId: queuedJob.jobId,
      action,
      actions: canonicalInput,
    },
  });
  await self.wbClustersRepository.completeSyncRun(syncRunId, {
    status: "succeeded",
    campaignsSeen: 1,
    campaignsSynced: 0,
    productsSeen: 1,
    clustersUpserted: canonicalInput.length,
    statsRowsUpserted: 0,
    errorMessage: "Изменение статуса кластеров поставлено в очередь на отправку в WB.",
  });

  // Записываем в историю изменений
  try {
    await self.wbClustersRepository.saveChangeLogEntries(
      canonicalInput.map((item) => ({
        nmId,
        advertId,
        clusterName: item.clusterName,
        changeType: "status_change" as const,
        oldValue: item.desiredIsActive ? "excluded" : "active",
        newValue: item.desiredIsActive ? "active" : "excluded",
        jobId: queuedJob.jobId,
        initiatedBy,
      })),
    );
  } catch (err: unknown) {
    self.logger?.warn(
      `Не удалось сохранить историю изменений статуса кластера: ${(err as Error).message}`,
    );
  }

  // Инвалидируем кэш cluster-table чтобы следующий GET вернул обновлённый статус кластера.
  invalidateProductAdvertisingSheetCaches(self, nmId);

  self.activateManualBidInteractiveWindow(
    "manual-cluster-action",
    self.manualBidInteractiveWindowMs,
  );
  self.scheduleClusterActionWritePass();

  return {
    nmId,
    advertId,
    jobId: queuedJob.jobId,
    status: "queued",
    queuedAt: queuedJob.queuedAt,
    action,
    actions: canonicalInput.map((item) => ({
      clusterName: item.clusterName,
      canonicalNormQuery: item.clusterName,
      desiredIsActive: item.desiredIsActive,
      status: "queued",
      retryAt: null,
      lastError: null,
    })),
    appliedAt,
  };
}

export async function applyProductClusterBids(
  self: WbClustersService,
  nmId: number,
  advertId: number,
  bids: Array<{ clusterName: string; bid: number }>,
) {
  if (!self.wbClustersRepository.isConfigured()) {
    throw new ServiceUnavailableException(
      "PostgreSQL не настроен. Невозможно изменить ставку кластера.",
    );
  }

  if (self.wbRuntimeConfigService.getPromotionTokenSource() === "missing") {
    throw new ServiceUnavailableException(
      "Не настроен WB Promotion API token. Невозможно изменить ставку кластера.",
    );
  }

  await self.wbClustersRepository.ensureSchema();

  const normalizedInput = Array.from(
    new Map(
      bids
        .map((item) => ({
          clusterName: item.clusterName.trim(),
          bid: item.bid,
        }))
        .filter(
          (item) => item.clusterName.length > 0 && Number.isFinite(item.bid) && item.bid > 0,
        )
        .map((item) => [self.normalizeAdvertisingText(item.clusterName), item]),
    ).values(),
  );

  if (normalizedInput.length === 0) {
    throw new BadRequestException("Не переданы корректные ставки для изменения.");
  }

  const mutationContext = await self.wbClustersRepository.getProductAdvertisingMutationContext({
    nmId,
    advertId,
    normalizedClusterNames: normalizedInput.map((item) => item.clusterName),
  });
  const campaign = mutationContext.campaign;
  if (!campaign) {
    throw new BadRequestException(`Не найдена рекламная кампания ${advertId} для товара ${nmId}.`);
  }

  if (campaign.paymentType !== "cpm" || campaign.bidType !== "manual") {
    throw new BadRequestException("Изменение ставки доступно только для кампаний manual + cpm.");
  }

  const editableClusters = new Map();
  for (const cluster of mutationContext.clusters) {
    const key = cluster.normalizedClusterName;
    if (cluster.sourceKind === "excluded" || cluster.isActive === false) {
      continue;
    }

    if (!editableClusters.has(key)) {
      editableClusters.set(key, cluster);
    }
    editableClusters.set(self.normalizeAdvertisingText(cluster.canonicalNormQuery), cluster);
  }

  for (const item of normalizedInput) {
    if (!editableClusters.has(self.normalizeAdvertisingText(item.clusterName))) {
      throw new BadRequestException(
        `Кластер «${item.clusterName}» сейчас недоступен для изменения ставки.`,
      );
    }
  }

  const canonicalInput = normalizedInput.map((item) => {
    const cluster = editableClusters.get(self.normalizeAdvertisingText(item.clusterName)) ?? null;
    if (!cluster) {
      throw new BadRequestException(
        `Кластер «${item.clusterName}» сейчас недоступен для изменения ставки.`,
      );
    }

    return {
      clusterName: cluster.canonicalNormQuery,
      bid: item.bid,
    };
  });

  const appliedAt = new Date().toISOString();
  const syncRunId = await self.wbClustersRepository.createSyncRun("manual");

  // Читаем текущие ставки до перезаписи, чтобы записать их как oldValue в историю.
  let oldBidsMap = new Map<string, number>();
  try {
    oldBidsMap = await self.wbClustersRepository.getCurrentClusterBids(
      nmId,
      advertId,
      canonicalInput.map((item) => item.clusterName),
    );
  } catch {
    // не блокируем основной поток если чтение упало
  }

  await self.wbClustersRepository.upsertClusterBids(
    canonicalInput.map((item) => ({
      advert_id: advertId,
      nm_id: nmId,
      norm_query: item.clusterName,
      bid: item.bid,
      bid_sync_status: "queued",
      bid_confirmed_at: null,
      bid_retry_at: null,
      bid_last_error: null,
    })),
  );

  // Инвалидируем кэш cluster-table и workspace для этого товара, чтобы
  // следующий GET вернул свежие данные с новой ставкой (не 20-минутный кэш).
  invalidateProductAdvertisingSheetCaches(self, nmId);

  const queuedJob = await self.wbClustersRepository.createClusterBidJob({
    advertId,
    nmId,
    bids: canonicalInput,
  });

  await self.wbClustersRepository.saveRawArchive({
    syncRunId,
    archiveType: "normquery-bids-queued",
    advertId,
    nmId,
    payload: {
      direction: "internal",
      entityType: "cluster-bid",
      requestIntent: "queue-manual-bid",
      queuedAt: queuedJob.queuedAt,
      jobId: queuedJob.jobId,
      bids: canonicalInput,
    },
  });
  await self.wbClustersRepository.completeSyncRun(syncRunId, {
    status: "succeeded",
    campaignsSeen: 1,
    campaignsSynced: 0,
    productsSeen: 1,
    clustersUpserted: canonicalInput.length,
    statsRowsUpserted: 0,
    errorMessage: "Ставка поставлена в очередь на отправку в WB.",
  });

  // Записываем в историю изменений
  try {
    await self.wbClustersRepository.saveChangeLogEntries(
      canonicalInput.map((item) => {
        const normalizedName = item.clusterName
          .trim()
          .toLocaleLowerCase("ru")
          .replace(/\s+/g, " ");
        const oldBid = oldBidsMap.get(normalizedName) ?? null;
        return {
          nmId,
          advertId,
          clusterName: item.clusterName,
          changeType: "bid_change" as const,
          oldValue: oldBid !== null ? String(oldBid) : null,
          newValue: String(item.bid),
          jobId: queuedJob.jobId,
          initiatedBy: "user" as const,
        };
      }),
    );
  } catch (err: unknown) {
    self.logger?.warn(
      `Не удалось сохранить историю изменений ставки: ${(err as Error).message}`,
    );
  }

  self.activateManualBidInteractiveWindow("manual-apply", self.manualBidInteractiveWindowMs);
  self.scheduleClusterBidWritePass();

  return {
    nmId,
    advertId,
    jobId: queuedJob.jobId,
    status: "queued",
    queuedAt: queuedJob.queuedAt,
    bids: canonicalInput.map((item) => ({
      clusterName: item.clusterName,
      canonicalNormQuery: item.clusterName,
      bid: item.bid,
      status: "queued",
      retryAt: null,
      lastError: null,
    })),
    appliedAt,
  };
}

