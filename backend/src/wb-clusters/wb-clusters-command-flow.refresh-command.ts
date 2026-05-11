import { ServiceUnavailableException } from "@nestjs/common";

type WbClustersService = any;

export async function refreshProductAdvertising(self: WbClustersService, nmId: number) {
  const runningRefresh = self.productRefreshInFlight.get(nmId);
  if (runningRefresh) {
    return {
      nmId,
      accepted: true,
      alreadyRunning: true,
      syncRunId: runningRefresh.syncRunId,
      status: "running",
      startedAt: runningRefresh.startedAt,
    };
  }

  if (!self.wbClustersRepository.isConfigured()) {
    throw new ServiceUnavailableException(
      "PostgreSQL не настроен. Невозможно обновить рекламу по товару.",
    );
  }

  if (self.wbRuntimeConfigService.getPromotionTokenSource() === "missing") {
    throw new ServiceUnavailableException(
      "Не настроен WB Promotion API token. Невозможно обновить рекламу по товару.",
    );
  }

  await self.wbClustersRepository.ensureSchema();
  const syncRunId = await self.wbClustersRepository.createSyncRun("manual");
  const startedAt = new Date().toISOString();

  const refreshJob = self
    .refreshProductAdvertisingInternal(nmId, syncRunId)
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unknown WB product advertising refresh error";
      self.logger.error(`Product advertising refresh failed for ${nmId}: ${message}`);
    })
    .finally(() => {
      self.productRefreshInFlight.delete(nmId);
    });

  self.productRefreshInFlight.set(nmId, {
    syncRunId,
    promise: refreshJob,
    startedAt,
  });
  void refreshJob;

  return {
    nmId,
    accepted: true,
    alreadyRunning: false,
    syncRunId,
    status: "running",
    startedAt,
  };
}

export async function getProductAdvertisingRefreshStatus(
  self: WbClustersService,
  nmId: number,
  syncRunId: string,
) {
  const syncRun = await self.wbClustersRepository.getSyncRun(syncRunId);
  if (!syncRun) {
    throw new ServiceUnavailableException(
      `Не найден запуск обновления рекламы ${syncRunId} для товара ${nmId}.`,
    );
  }

  return {
    nmId,
    syncRunId,
    status: syncRun.status,
    startedAt: syncRun.startedAt,
    finishedAt: syncRun.finishedAt,
    campaignsSeen: syncRun.campaignsSeen,
    campaignsSynced: syncRun.campaignsSynced,
    productsSeen: syncRun.productsSeen,
    clustersUpserted: syncRun.clustersUpserted,
    statsRowsUpserted: syncRun.statsRowsUpserted,
    warningCount: syncRun.warningCount,
    hasPartialFailure: syncRun.hasPartialFailure,
    warningMessage: syncRun.errorMessage,
  };
}

