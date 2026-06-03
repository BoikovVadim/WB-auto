import { tryReadStoredWbExport } from "../wb-sync/wb-export-archive.store";
import { getHourlyProductAdvertisingWarmPeriods as getHourlyProductAdvertisingWarmPeriodsValue } from "./product-advertising-sheet.snapshot";
import type { ProductSnapshotWarmupPriority } from "./wb-clusters.types";
import type { WbClustersMaterializeContext } from "./wb-clusters.flow-context";

export async function materializeProductAdvertisingSheetsForNmIds(
  self: WbClustersMaterializeContext,
  nmIds: number[],
  reason = "manual-products-tab-materialize",
  exportRequestId?: string,
  startDate?: string,
  endDate?: string,
  priority: ProductSnapshotWarmupPriority = "background",
) {
  const uniqueNmIds = Array.from(new Set(nmIds.filter((value) => Number.isInteger(value) && value > 0)));
  const explicitPeriod =
    startDate && endDate ? self.normalizeAdvertisingSheetJamRange(startDate, endDate) : null;
  const savedExport = exportRequestId ? await tryReadStoredWbExport(exportRequestId) : null;
  if (uniqueNmIds.length === 0) {
    return {
      accepted: true,
      nmIdsQueued: 0,
      reason,
      startedAt: new Date().toISOString(),
    };
  }

  self.markProductSnapshotWarmupQueued(uniqueNmIds, explicitPeriod, exportRequestId ?? null, priority);

  let presetJobId: string | null = null;
  if (explicitPeriod && exportRequestId) {
    const exactSnapshots = await self.wbClustersRepository.getExactReadyProductAdvertisingSnapshotSummaries({
      nmIds: uniqueNmIds,
      startDate: explicitPeriod.start,
      endDate: explicitPeriod.end,
      schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
    });
    const exactSnapshotNmIdSet = new Set(exactSnapshots.map((item: any) => item.nmId));
    const isExactSnapshotCoverageComplete = uniqueNmIds.every((nmId: number) =>
      exactSnapshotNmIdSet.has(nmId),
    );
    const presetJob = await self.wbClustersRepository.createOrUpdateProductPresetSnapshotJob({
      sourceExportRequestId: exportRequestId,
      startDate: explicitPeriod.start,
      endDate: explicitPeriod.end,
      nmIds: uniqueNmIds,
      reason,
      allowSucceededRequeue: !isExactSnapshotCoverageComplete,
    });
    presetJobId = presetJob.jobId;
  }

  if (
    explicitPeriod &&
    savedExport &&
    savedExport.entityType === "product_search_texts" &&
    savedExport.payload.period.currentStart === explicitPeriod.start &&
    savedExport.payload.period.currentEnd === explicitPeriod.end
  ) {
    self.productPresetSnapshotOrchestratorService.scheduleExactFromSavedExport(
      {
        jobId: presetJobId,
        exportRequestId: exportRequestId!,
        nmIds: uniqueNmIds,
        explicitPeriod,
        reason,
        priority,
      },
      {
        describeError: (error: unknown) => self.describeError(error),
        markWarmupQueued: (
          nextNmIds: number[],
          period: { start: string; end: string } | null,
          savedExportRequestId: string | null,
          warmupPriority: ProductSnapshotWarmupPriority,
        ) =>
          self.markProductSnapshotWarmupQueued(
            nextNmIds,
            period,
            savedExportRequestId,
            warmupPriority,
          ),
        markWarmupRunning: (nextNmIds: number[], period: { start: string; end: string }, savedExportRequestId: string | null) =>
          self.markProductSnapshotWarmupRunning(nextNmIds, period, savedExportRequestId),
        markWarmupFailed: (nextNmIds: number[], period: { start: string; end: string }, savedExportRequestId: string | null, failureReason: string) =>
          self.markProductSnapshotWarmupFailed(
            nextNmIds,
            period,
            savedExportRequestId,
            failureReason,
          ),
        clearWarmupState: (nextNmIds: number[], period: { start: string; end: string }, savedExportRequestId: string | null) =>
          self.clearProductSnapshotWarmupState(nextNmIds, period, savedExportRequestId),
        runExactMaterializationFromExport: (savedExportRequestId: string, nextNmIds: number[], period: { start: string; end: string }, queueReason: string) =>
          self.runExactProductPresetMaterializationFromExport(
            savedExportRequestId,
            nextNmIds,
            period,
            queueReason,
          ),
      },
    );
  } else {
    self.scheduleProductAdvertisingSheetWarmup(uniqueNmIds, reason, explicitPeriod, priority);
    if (explicitPeriod && exportRequestId) {
      void self.productPresetSnapshotOrchestratorService
        .processJobs({
          describeError: (error: unknown) => self.describeError(error),
          markWarmupQueued: (
            nextNmIds: number[],
            period: { start: string; end: string } | null,
            savedExportRequestId: string | null,
            warmupPriority: ProductSnapshotWarmupPriority,
          ) =>
            self.markProductSnapshotWarmupQueued(
              nextNmIds,
              period,
              savedExportRequestId,
              warmupPriority,
            ),
          markWarmupRunning: (nextNmIds: number[], period: { start: string; end: string }, savedExportRequestId: string | null) =>
            self.markProductSnapshotWarmupRunning(nextNmIds, period, savedExportRequestId),
          markWarmupFailed: (nextNmIds: number[], period: { start: string; end: string }, savedExportRequestId: string | null, failureReason: string) =>
            self.markProductSnapshotWarmupFailed(
              nextNmIds,
              period,
              savedExportRequestId,
              failureReason,
            ),
          clearWarmupState: (nextNmIds: number[], period: { start: string; end: string }, savedExportRequestId: string | null) =>
            self.clearProductSnapshotWarmupState(nextNmIds, period, savedExportRequestId),
          runExactMaterializationFromExport: (savedExportRequestId: string, nextNmIds: number[], period: { start: string; end: string }, queueReason: string) =>
            self.runExactProductPresetMaterializationFromExport(
              savedExportRequestId,
              nextNmIds,
              period,
              queueReason,
            ),
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : "Unknown preset snapshot queue error";
          self.logger.warn(
            `Unable to process preset snapshot jobs after ${reason}: ${message}`,
          );
        });
    }
  }

  return {
    accepted: true,
    nmIdsQueued: uniqueNmIds.length,
    reason,
    startedAt: new Date().toISOString(),
  };
}

export function scheduleProductAdvertisingSheetWarmup(
  self: WbClustersMaterializeContext,
  nmIds: number[],
  reason: string,
  explicitPeriod?: { start: string; end: string } | null,
  priority: ProductSnapshotWarmupPriority = "background",
) {
  const uniqueNmIds = Array.from(new Set(nmIds.filter((value) => Number.isInteger(value) && value > 0)));
  if (uniqueNmIds.length === 0) {
    return;
  }

  void materializeProductAdvertisingSheets(self, uniqueNmIds, reason, explicitPeriod, null, priority)
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unknown product advertising materialization error";
      self.logger.warn(
        `Unable to materialize product advertising sheets after ${reason}: ${message}`,
      );
    });
}

export async function materializeProductAdvertisingSheets(
  self: WbClustersMaterializeContext,
  nmIds: number[],
  reason: string,
  explicitPeriod?: { start: string; end: string } | null,
  exportRequestId?: string | null,
  priority: ProductSnapshotWarmupPriority = "background",
) {
  await self.productAdvertisingSnapshotJobService.materializeSnapshots({
    nmIds,
    reason,
    explicitPeriod,
    getWarmPeriods: () => self.getHourlyProductAdvertisingWarmPeriods(),
    materializeSnapshot: async (nmId: number, period: { start: string; end: string }) => {
      await self.materializeProductAdvertisingSheetSnapshot(nmId, period);
    },
    invalidateCaches: (nmId: number) => self.invalidateProductAdvertisingSheetCaches(nmId),
    concurrency: self.resolveProductSnapshotWarmupConcurrency(priority),
    onRunning: (nmId: number, period: { start: string; end: string }) => {
      self.markProductSnapshotWarmupRunning([nmId], period, exportRequestId ?? null);
    },
    onSucceeded: (nmId: number, period: { start: string; end: string }) => {
      self.clearProductSnapshotWarmupState([nmId], period, exportRequestId ?? null);
    },
    onFailed: (nmId: number, period: { start: string; end: string }, errorMessage: string) => {
      self.markProductSnapshotWarmupFailed([nmId], period, exportRequestId ?? null, errorMessage);
    },
  });
}

export function resolveProductSnapshotWarmupConcurrency(
  self: WbClustersMaterializeContext,
  priority: string,
) {
  switch (priority) {
    // "startup" – used only by triggerStartupWarmup. Very low concurrency so the
    // warmup does not starve the Node.js event loop or the DB connection pool.
    // 431 products / 2 = ~216 serial batches; at ~2 s each = ~7 min total warmup,
    // which is acceptable because the server is still serving HTTP requests normally.
    // "startup" – сервер только стартовал, держим нагрузку низкой.
    case "startup":
      return 2;
    // "precompute" – ночной bulk-прогон по ВСЕМ товарам (precomputeNextDayPeriod).
    // Строго 1 одновременная сборка: каждый build тянет всю «вселенную запросов»
    // товара из wb_cabinet_cluster_queries (8M+ строк) в JS-объекты; при concurrency 5
    // пять таких «месячных» сборок одновременно пробивали heap-лимит 1536 МБ и роняли
    // бэкенд FATAL heap OOM каждый вечер (≈19:30). Дневной on-demand путь делает по
    // одной сборке за раз и память не пробивает — поэтому сериализуем ночной прогон.
    case "precompute":
      return 1;
    // Интерактивный прогрев при открытии товара пользователем.
    case "visible":
      return 3;
    case "candidate":
      return 2;
    // Фоновая материализация после синка: 5 одновременных продуктов.
    // Пул соединений БД = 25; с несколькими параллельными синк-триггерами
    // 5 конкурентных материализаций + ~5 других запросов = безопасно.
    default:
      return 5;
  }
}

export function getHourlyProductAdvertisingWarmPeriods(self: WbClustersMaterializeContext) {
  return getHourlyProductAdvertisingWarmPeriodsValue({
    now: new Date(),
    parseAdvertisingSheetDayValue: (value) => self.parseAdvertisingSheetDayValue(value),
    formatAdvertisingSheetDate: (value) => self.formatAdvertisingSheetDate(value),
    addAdvertisingSheetDays: (value, days) => self.addAdvertisingSheetDays(value, days),
  });
}
