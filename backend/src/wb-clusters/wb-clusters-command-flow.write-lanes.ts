import { appEnv } from "../common/env";
import { normalizeBidFromWb } from "./wb-clusters-queue.helpers";
import type { ProductSnapshotWarmupPriority } from "./wb-clusters.types";
import type { WbClustersWriteLanesContext } from "./wb-clusters.flow-context";

export function scheduleClusterBidWritePass(self: WbClustersWriteLanesContext) {
  if (self.bidQueuePassTimer) {
    clearTimeout(self.bidQueuePassTimer);
  }

  self.bidQueuePassTimer = setTimeout(() => {
    self.bidQueuePassTimer = null;
    void self.processClusterBidWritePass("apply-command");
  }, self.manualBidBatchWindowMs);
}

export function scheduleClusterActionWritePass(self: WbClustersWriteLanesContext) {
  if (self.actionQueuePassTimer) {
    clearTimeout(self.actionQueuePassTimer);
  }

  self.actionQueuePassTimer = setTimeout(() => {
    self.actionQueuePassTimer = null;
    void self.processClusterActionWritePass("apply-command");
  }, self.manualBidBatchWindowMs);
}

export function isPromotionLowNoiseModeActive(self: WbClustersWriteLanesContext) {
  return (
    self.isManualBidInteractiveWindowActive() ||
    self.wbPromotionApiClient.hasActiveSellerCooldown() ||
    self.wbPromotionApiClient.hasActiveBackgroundReadSuppression()
  );
}

export function getPromotionLowNoiseRemainingMs(self: WbClustersWriteLanesContext) {
  return Math.max(
    self.getManualBidInteractiveRemainingMs(),
    self.wbPromotionApiClient.getSellerCooldownRemainingMs(),
    self.wbPromotionApiClient.getBackgroundReadSuppressionRemainingMs(),
  );
}

export async function handleClusterBidQueue(self: WbClustersWriteLanesContext) {
  if (
    !self.promotionSyncRepository.isConfigured() ||
    self.wbRuntimeConfigService.getPromotionTokenSource() === "missing"
  ) {
    return;
  }

  try {
    await self.processClusterBidWritePass("cron");
  } catch (error) {
    self.logger.warn(`Cluster bid write pass failed: ${self.describeError(error)}`);
  }
}

export async function handleClusterActionQueue(self: WbClustersWriteLanesContext) {
  if (
    !self.wbClustersRepository.isConfigured() ||
    self.wbRuntimeConfigService.getPromotionTokenSource() === "missing"
  ) {
    return;
  }

  try {
    await self.processClusterActionWritePass("cron");
  } catch (error) {
    self.logger.warn(`Cluster action write pass failed: ${self.describeError(error)}`);
  }
}

export async function handleClusterBidReconcileQueue(self: WbClustersWriteLanesContext) {
  if (
    !self.wbClustersRepository.isConfigured() ||
    self.wbRuntimeConfigService.getPromotionTokenSource() === "missing"
  ) {
    return;
  }

  if (self.isPromotionLowNoiseModeActive()) {
    return;
  }

  try {
    const cleanedLegacyJobs = await self.wbClustersRepository.failActiveClusterBidReconcileJobs(
      "Legacy reconcile job cancelled: accepted bid writes are now confirmed locally without WB readback.",
    );
    if (cleanedLegacyJobs > 0) {
      self.logger.log(
        `Cancelled ${cleanedLegacyJobs} legacy cluster bid reconcile jobs after switching to local confirmation.`,
      );
      return;
    }
    await self.processClusterBidReconcilePass();
  } catch (error) {
    self.logger.warn(`Cluster bid reconcile pass failed: ${self.describeError(error)}`);
  }
}

export async function handleProductPresetSnapshotQueue(self: WbClustersWriteLanesContext) {
  if (!self.wbClustersRepository.isConfigured()) {
    return;
  }

  try {
    await self.productPresetSnapshotOrchestratorService.processJobs({
      describeError: (error: unknown) => self.describeError(error),
      markWarmupQueued: (
        nmIds: number[],
        period: { start: string; end: string } | null,
        exportRequestId: string | null,
        priority: ProductSnapshotWarmupPriority,
      ) =>
        self.markProductSnapshotWarmupQueued(nmIds, period, exportRequestId, priority),
      markWarmupRunning: (nmIds: number[], period: { start: string; end: string }, exportRequestId: string | null) =>
        self.markProductSnapshotWarmupRunning(nmIds, period, exportRequestId),
      markWarmupFailed: (nmIds: number[], period: { start: string; end: string }, exportRequestId: string | null, failureReason: string) =>
        self.markProductSnapshotWarmupFailed(nmIds, period, exportRequestId, failureReason),
      clearWarmupState: (nmIds: number[], period: { start: string; end: string }, exportRequestId: string | null) =>
        self.clearProductSnapshotWarmupState(nmIds, period, exportRequestId),
      runExactMaterializationFromExport: (exportRequestId: string, nmIds: number[], period: { start: string; end: string }, reason: string) =>
        self.runExactProductPresetMaterializationFromExport(exportRequestId, nmIds, period, reason),
    });
  } catch (error) {
    self.logger.warn(`Product preset snapshot queue pass failed: ${self.describeError(error)}`);
  }
}

export async function processClusterBidWritePass(
  self: WbClustersWriteLanesContext,
  reason: "apply-command" | "cron",
) {
  // Read-only (миграция): не флашим ставки в WB ни по крону, ни по немедленному apply-command —
  // job'ы остаются в очереди pending, в чужой боевой кабинет не пишем. Абсолютный рубеж — в клиенте.
  if (appEnv.wbAutomationReadOnly) {
    return;
  }
  if (self.bidQueuePassPromise) {
    return self.bidQueuePassPromise;
  }

  if (self.wbPromotionApiClient.hasActiveBidWriteCooldown()) {
    return;
  }

  self.bidQueuePassPromise = self.wbClustersBidQueueService
    .processWritePass(reason, {
      maxBidJobsPerPass: self.maxBidJobsPerPass,
      maxClusterBidJobAttempts: self.maxClusterBidJobAttempts,
      manualBidInteractiveWindowMs: self.manualBidInteractiveWindowMs,
      retryBidInteractiveWindowMs: self.retryBidInteractiveWindowMs,
      activateManualBidInteractiveWindow: (queueReason: string, durationMs: number) =>
        self.activateManualBidInteractiveWindow(queueReason, durationMs),
      isRecoverablePromotionError: (error: unknown) => self.isRecoverablePromotionError(error),
      normalizeAdvertisingText: (value: string) => self.normalizeAdvertisingText(value),
      invalidateSheetCaches: (nmId: number) => self.invalidateProductAdvertisingSheetCaches(nmId),
      normalizeNormQueryBidsFromWb: (bids: any[]) => self.normalizeNormQueryBidsFromWb(bids),
    })
    .finally(() => {
      self.bidQueuePassPromise = null;
    });

  return self.bidQueuePassPromise;
}

export async function processClusterActionWritePass(
  self: WbClustersWriteLanesContext,
  reason: "apply-command" | "cron",
) {
  // Read-only (миграция): не флашим вкл/выкл кластеров в WB (см. processClusterBidWritePass).
  if (appEnv.wbAutomationReadOnly) {
    return;
  }
  if (self.actionQueuePassPromise) {
    return self.actionQueuePassPromise;
  }

  if (self.wbPromotionApiClient.hasActiveMinusWriteCooldown()) {
    return;
  }

  self.actionQueuePassPromise = self.wbClustersActionQueueService
    .processWritePass(reason, {
      maxActionJobsPerPass: self.maxActionJobsPerPass,
      maxActionGroupsPerBatch: self.maxActionGroupsPerBatch,
      maxClusterActionJobAttempts: self.maxClusterActionJobAttempts,
      manualBidInteractiveWindowMs: self.manualBidInteractiveWindowMs,
      retryBidInteractiveWindowMs: self.retryBidInteractiveWindowMs,
      activateManualBidInteractiveWindow: (queueReason: string, durationMs: number) =>
        self.activateManualBidInteractiveWindow(queueReason, durationMs),
      isRecoverablePromotionError: (error: unknown) => self.isRecoverablePromotionError(error),
      normalizeAdvertisingText: (value: string) => self.normalizeAdvertisingText(value),
      invalidateSheetCaches: (nmId: number) => self.invalidateProductAdvertisingSheetCaches(nmId),
    })
    .finally(() => {
      self.actionQueuePassPromise = null;
    });

  return self.actionQueuePassPromise;
}

export async function processClusterBidReconcilePass(self: WbClustersWriteLanesContext) {
  if (self.bidReconcilePassPromise) {
    return self.bidReconcilePassPromise;
  }

  self.bidReconcilePassPromise = self.wbClustersBidQueueService
    .processReconcilePass({
      maxBidJobsPerPass: self.maxBidJobsPerPass,
      maxClusterBidJobAttempts: self.maxClusterBidJobAttempts,
      manualBidInteractiveWindowMs: self.manualBidInteractiveWindowMs,
      retryBidInteractiveWindowMs: self.retryBidInteractiveWindowMs,
      activateManualBidInteractiveWindow: (queueReason: string, durationMs: number) =>
        self.activateManualBidInteractiveWindow(queueReason, durationMs),
      isRecoverablePromotionError: (error: unknown) => self.isRecoverablePromotionError(error),
      normalizeAdvertisingText: (value: string) => self.normalizeAdvertisingText(value),
      invalidateSheetCaches: (nmId: number) => self.invalidateProductAdvertisingSheetCaches(nmId),
      normalizeNormQueryBidsFromWb: (bids: any[]) => self.normalizeNormQueryBidsFromWb(bids),
    })
    .finally(() => {
      self.bidReconcilePassPromise = null;
    });

  return self.bidReconcilePassPromise;
}

export function scheduleProductAdvertisingRefresh(
  self: WbClustersWriteLanesContext,
  nmId: number,
  reason: string,
) {
  if (self.isPromotionLowNoiseModeActive()) {
    const delayMs = self.getPromotionLowNoiseRemainingMs() + 1_000;
    self.logger.log(
      `Deferring product advertising refresh for ${nmId} after ${reason} by ${delayMs} ms because WB low-noise mode is active.`,
    );
    setTimeout(() => {
      void self.refreshProductAdvertising(nmId).catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Unknown product advertising refresh error";
        self.logger.warn(
          `Unable to run deferred product advertising refresh for ${nmId}: ${message}`,
        );
      });
    }, delayMs);
    return;
  }

  void self.refreshProductAdvertising(nmId).catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown product advertising refresh error";
    self.logger.warn(
      `Unable to schedule product advertising refresh for ${nmId} after ${reason}: ${message}`,
    );
  });
}

export function normalizeNormQueryBidsFromWb(
  self: WbClustersWriteLanesContext,
  bids: Array<{
    advert_id: number;
    nm_id: number;
    norm_query: string;
    bid?: number;
  }>,
) {
  return bids.map((item) => ({
    ...item,
    bid:
      typeof item.bid === "number" && Number.isFinite(item.bid)
        ? normalizeBidFromWb(item.bid)
        : undefined,
  }));
}

export function normalizeAdvertisingText(self: WbClustersWriteLanesContext, value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/[_/\\|.,:;!?()[\]{}"'+=*%#№@`~^&-]+/g, " ")
    .replace(/\s+/g, " ");
}
