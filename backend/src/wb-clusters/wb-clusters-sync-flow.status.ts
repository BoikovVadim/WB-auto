import { ServiceUnavailableException } from "@nestjs/common";

import { appEnv } from "../common/env";
import {
  buildSyncPhaseTelemetrySnapshot,
  estimatePhaseSweepMinutes,
  recordSyncPhaseTelemetry,
} from "./wb-clusters-sync.helpers";
import type { WbClustersSyncOrchestratorService } from "./wb-clusters-sync-orchestrator.service";

type WbClustersService = any;

export async function getStatus(self: WbClustersService) {
  if (!self.syncInFlight) {
    await self.promotionSyncRepository.failStaleRunningSyncs(
      "Cluster sync was interrupted before completion.",
    );
  }

  const [
    counts,
    lastSyncRun,
    globalSyncCursorState,
    inventoryCursorState,
    structureCursorState,
    statsCursorState,
  ] = await Promise.all([
    self.promotionSyncRepository.getDashboardCounts(),
    self.promotionSyncRepository.getLastSyncRun(),
    self.promotionSyncRepository.getSyncCursorState(),
    self.promotionSyncRepository.getSyncCursorState("inventory"),
    self.promotionSyncRepository.getSyncCursorState("structure"),
    self.promotionSyncRepository.getSyncCursorState("stats"),
  ]);
  const phaseSweepMinutes = {
    inventory: estimatePhaseSweepMinutes(self.syncPhaseTelemetry.inventory, counts.campaignsStored),
    structure: estimatePhaseSweepMinutes(self.syncPhaseTelemetry.structure, counts.campaignsStored),
    stats: estimatePhaseSweepMinutes(self.syncPhaseTelemetry.stats, counts.campaignsStored),
  };

  return {
    service: "wb-clusters",
    dbConfigured: self.promotionSyncRepository.isConfigured(),
    promotionTokenConfigured: self.wbRuntimeConfigService.getPromotionTokenSource() !== "missing",
    promotionTokenSource: self.wbRuntimeConfigService.getPromotionTokenSource(),
    cabinetSession: await self.wbCabinetPrivateApiClient.getSessionStatus(),
    scheduleEnabled: appEnv.wbPromotionSyncEnabled,
    syncStrategy: "continuous-global-batching",
    statsLookbackDays: appEnv.wbPromotionStatsLookbackDays,
    activeSyncRunId: self.currentSyncRunId,
    syncCursor: {
      lastCompletedAdvertId: globalSyncCursorState.lastCompletedAdvertId,
      lastSyncRunId: globalSyncCursorState.lastSyncRunId,
    },
    syncPhaseCursors: {
      inventory: inventoryCursorState,
      structure: structureCursorState,
      stats: statsCursorState,
    },
    phaseCoverage: {
      inventory: "full-pool",
      structure: "full-pool",
      stats: "full-pool",
    },
    phaseChunkSizes: {
      detailsAdvertIdsPerRequest: self.campaignDetailsChunkSize,
      normQueryItemsPerRequest: self.normQueryReadChunkSize,
    },
    estimatedFullSweepMinutes:
      self.maxDefinedNumber(
        phaseSweepMinutes.inventory,
        phaseSweepMinutes.structure,
        phaseSweepMinutes.stats,
      ) ?? null,
    estimatedPhaseSweepMinutes: phaseSweepMinutes,
    phaseTelemetry: {
      inventory: buildSyncPhaseTelemetrySnapshot(self.syncPhaseTelemetry.inventory),
      structure: buildSyncPhaseTelemetrySnapshot(self.syncPhaseTelemetry.structure),
      stats: buildSyncPhaseTelemetrySnapshot(self.syncPhaseTelemetry.stats),
    },
    promotionApiTelemetry: self.wbPromotionApiClient.getTelemetrySnapshot(),
    campaignsStored: counts.campaignsStored,
    productsStored: counts.productsStored,
    clustersStored: counts.clustersStored,
    statsRowsStored: counts.statsRowsStored,
    lastSyncRun,
    checkedAt: new Date().toISOString(),
  };
}

export async function runSync(
  self: WbClustersService,
  trigger: string = "manual",
  mode: string = "full",
) {
  if (self.syncInFlight) {
    return {
      accepted: true,
      alreadyRunning: true,
      syncRunId: self.currentSyncRunId ?? "running-sync",
      status: "running",
      trigger,
      mode,
      startedAt: new Date().toISOString(),
    };
  }

  if (!self.wbClustersRepository.isConfigured()) {
    throw new ServiceUnavailableException(
      "PostgreSQL не настроен. Укажите DATABASE_URL или PGHOST/PGUSER/PGDATABASE.",
    );
  }

  if (self.wbRuntimeConfigService.getPromotionTokenSource() === "missing") {
    throw new ServiceUnavailableException(
      "Не настроен WB Promotion API token для official WB clusters.",
    );
  }

  await self.wbClustersRepository.ensureSchema();
  await self.wbClustersRepository.failStaleRunningSyncs(
    "Cluster sync was interrupted before completion.",
  );

  const syncRunId = await self.wbClustersRepository.createSyncRun(trigger);
  self.currentSyncRunId = syncRunId;

  const runtime: Parameters<WbClustersSyncOrchestratorService["runSyncInternal"]>[3] = {
    syncMonthlyFrequencyReadModel: (input) => self.syncMonthlyFrequencyReadModel(input),
    runInventorySyncPhase: (currentSyncRunId) => self.runInventorySyncPhase(currentSyncRunId),
    runStructureSyncPhase: (currentSyncRunId) => self.runStructureSyncPhase(currentSyncRunId),
    runStatsSyncPhase: (currentSyncRunId) => self.runStatsSyncPhase(currentSyncRunId),
    runJamSyncForNmIds: async (_nmIds, _warningMessages) => {
      // No-op: today's JAM data is handled by the dedicated continuous loop
      // (runJamTodayLoop) started at module init.  Historical gap-fill (yesterday
      // and older) is handled by the nightly cron (handleScheduledJamSync, 01:00 MSK).
      // Running JAM inside the 10-minute advertising sync was superseded when the
      // continuous loop was introduced — duplicating the fetch here would send
      // double the requests to WB within the same 65-minute cooldown window.
    },
    recordPhaseTelemetry: (phase, campaignsSynced, elapsedMs) =>
      recordSyncPhaseTelemetry(self.syncPhaseTelemetry[phase], campaignsSynced, elapsedMs),
    materializeProductAdvertisingSheets: (_nmIds, _reason) => {
      // Post-sync bulk materialization is intentionally disabled.
      // The SQL-direct fast path handles any date range directly from
      // wb_cluster_daily_stats in < 150 ms — no pre-materialization is needed.
      // Running PATH B for all 431+ products after every 10-minute sync was
      // the root cause of 90%+ CPU spikes, OOM crashes (Node heap grows to 1.5 GB),
      // and 10+ second user-facing latency.
      // The nightly precompute cron (22:30 MSK) keeps DB snapshots warm overnight.
      return Promise.resolve();
    },
    scheduleWeekPeriodMaterialization: (_nmIds) => {
      // Post-stats bulk materialization is intentionally disabled.
      // The SQL-direct fast path computes any date range directly from
      // wb_cluster_daily_stats in <150 ms, so there is no need to
      // pre-materialise all products after every sync cycle.
      // This was the primary source of 90 % CPU spikes and OOM crashes.
      // The nightly precompute cron (22:30 MSK) covers overnight pre-warming.
    },
    summarizeWarnings: (warningMessages) => self.summarizeWarnings(warningMessages),
  };
  const job = self.wbClustersSyncOrchestratorService
    .runSyncInternal(trigger, syncRunId, mode, runtime)
    .finally(() => {
      self.syncInFlight = null;
      self.currentSyncRunId = null;
    });
  self.syncInFlight = job;
  void job;

  return {
    accepted: true,
    alreadyRunning: false,
    syncRunId,
    status: "running",
    trigger,
    mode,
    startedAt: new Date().toISOString(),
  };
}

export async function lookupProductClusters(
  self: WbClustersService,
  nmId: number,
  queries: string[],
) {
  const matches = await self.wbClustersRepository.lookupProductClusters(nmId, queries);

  return {
    nmId,
    checkedAt: new Date().toISOString(),
    matches,
  };
}

export async function handleScheduledSync(self: WbClustersService) {
  if (!appEnv.wbPromotionSyncEnabled) {
    return;
  }

  if (
    !self.wbClustersRepository.isConfigured() ||
    self.wbRuntimeConfigService.getPromotionTokenSource() === "missing"
  ) {
    return;
  }

  try {
    await self.runSync("schedule");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cluster sync error";
    self.logger.error(`Scheduled cluster sync failed: ${message}`);
  }
}

export async function handleScheduledJamSync(self: WbClustersService) {
  if (!appEnv.wbPromotionJamSyncEnabled) {
    return;
  }

  if (
    !self.wbClustersRepository.isConfigured() ||
    self.wbRuntimeConfigService.getPromotionTokenSource() === "missing"
  ) {
    return;
  }

  if (self.jamSyncInFlight) {
    self.logger.log("Scheduled JAM sync: previous run still in progress, skipping.");
    return;
  }

  const job = (async () => {
    try {
      self.logger.log("Starting scheduled JAM sync.");

      // Prune raw WB API archive payloads (ephemeral JSONB blobs, not business data).
      // JAM per-day snapshots and sync run audit rows are kept forever so historical
      // analysis across any date range remains possible.
      try {
        const archivePruned = await self.wbClustersRepository.pruneOldRawArchives();
        if (archivePruned.archivesDeleted > 0) {
          self.logger.log(
            `Nightly DB prune: deleted ${archivePruned.archivesDeleted} raw WB API archive entries older than 14 days.`,
          );
        }
      } catch (pruneError) {
        const msg = pruneError instanceof Error ? pruneError.message : String(pruneError);
        self.logger.warn(`Nightly raw-archive prune failed (non-fatal): ${msg}`);
      }

      const nmIds = await self.wbClustersRepository.getAllKnownNmIds();
      if (nmIds.length === 0) {
        self.logger.log("Scheduled JAM sync: no nmIds found, skipping.");
        return;
      }
      const warningMessages: string[] = [];

      // Step 1: finalize yesterday unconditionally.
      // The today-loop saves intraday snapshots throughout the day.  After
      // midnight those snapshots are stale partials.  We force-refresh them
      // here so yesterday's data reflects the fully finalized WB numbers.
      await self.finalizeJamYesterday(nmIds, warningMessages);

      // Step 2: gap-fill any historical dates that have no snapshot yet.
      // findMissingDailyJamDates only returns dates with NO snapshot, so
      // yesterday (just finalized above) is correctly skipped here.
      await self.runJamSyncForNmIds(nmIds, warningMessages);

      self.logger.log(
        `Scheduled JAM sync completed for ${nmIds.length} nmIds. Warnings: ${warningMessages.length}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown JAM sync error";
      self.logger.error(`Scheduled JAM sync failed: ${message}`);
    } finally {
      self.jamSyncInFlight = null;
    }
  })();
  self.jamSyncInFlight = job;
  await job;
}

export async function handleScheduledMonthlyFrequencySync(self: WbClustersService) {
  if (!appEnv.wbPromotionSyncEnabled) {
    return;
  }

  if (!self.wbClustersRepository.isConfigured()) {
    return;
  }

  const warningMessages: string[] = [];
  let syncRunId: string | null = null;

  try {
    await self.wbClustersRepository.ensureSchema();
    syncRunId = await self.wbClustersRepository.createSyncRun("schedule");
    await self.syncMonthlyFrequencyReadModel({
      syncRunId,
      nmId: null,
      warningMessages,
    });
    await self.wbClustersRepository.completeSyncRun(syncRunId, {
      status: "succeeded",
      campaignsSeen: 0,
      campaignsSynced: 0,
      productsSeen: 0,
      clustersUpserted: 0,
      statsRowsUpserted: 0,
      warningCount: warningMessages.length,
      hasPartialFailure: warningMessages.length > 0,
      errorMessage: self.summarizeWarnings(warningMessages),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown monthly frequency sync error";
    if (syncRunId) {
      await self.wbClustersRepository.completeSyncRun(syncRunId, {
        status: "failed",
        campaignsSeen: 0,
        campaignsSynced: 0,
        productsSeen: 0,
        clustersUpserted: 0,
        statsRowsUpserted: 0,
        warningCount: warningMessages.length,
        hasPartialFailure: warningMessages.length > 0,
        errorMessage: message,
      });
    }
    self.logger.error(`Scheduled monthly frequency sync failed: ${message}`);
  }
}

export async function runMonthlyFrequencySyncNow(self: WbClustersService) {
  return handleScheduledMonthlyFrequencySync(self);
}

/**
 * Runs JAM sync immediately for all known nmIds.
 * On first call after deployment this performs a full 30-day backfill.
 * On subsequent calls it is mostly a no-op (only today's snapshot is re-fetched).
 * Safe to call while a scheduled sync is already running — it will skip.
 */
export async function handleJamBackfill(self: WbClustersService): Promise<{
  skipped: boolean;
  nmIds: number;
  warnings: number;
}> {
  if (
    !self.wbClustersRepository.isConfigured() ||
    self.wbRuntimeConfigService.getPromotionTokenSource() === "missing"
  ) {
    return { skipped: true, nmIds: 0, warnings: 0 };
  }

  if (self.jamSyncInFlight) {
    self.logger.log("JAM backfill: previous JAM sync is still in progress, skipping.");
    return { skipped: true, nmIds: 0, warnings: 0 };
  }

  const nmIds = await self.wbClustersRepository.getAllKnownNmIds();
  if (nmIds.length === 0) {
    return { skipped: false, nmIds: 0, warnings: 0 };
  }

  self.logger.log(`Starting JAM backfill for ${nmIds.length} nmIds.`);
  const warningMessages: string[] = [];

  const job = (async () => {
    try {
      await self.runJamSyncForNmIds(nmIds, warningMessages);
      self.logger.log(
        `JAM backfill completed for ${nmIds.length} nmIds. Warnings: ${warningMessages.length}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown JAM backfill error";
      self.logger.error(`JAM backfill failed: ${message}`);
    } finally {
      self.jamSyncInFlight = null;
    }
  })();
  self.jamSyncInFlight = job;

  return { skipped: false, nmIds: nmIds.length, warnings: warningMessages.length };
}
