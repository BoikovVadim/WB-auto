import { ServiceUnavailableException } from "@nestjs/common";

import {
  getClusterActionJobRetryDelayMs,
  getPromotionRetryDelayMs,
  getRecoverableActionSyncStatus,
  hasExceededClusterActionJobAttempts,
} from "./wb-clusters-queue.helpers";
import type {
  ActionQueueRuntime,
  ClusterActionMinusRequestItem,
  PreparedClusterActionWriteGroup,
} from "./wb-clusters-action-queue.types";
import type { ClusterActionSyncStatus } from "./wb-clusters.types";

import { WbClustersActionQueuePrepare } from "./wb-clusters-action-queue.prepare";

export abstract class WbClustersActionQueueBatch extends WbClustersActionQueuePrepare {
  protected async processWriteMultiGroupBatch(
    groups: PreparedClusterActionWriteGroup[],
    reason: "apply-command" | "cron",
    runtime: ActionQueueRuntime,
  ) {
    const allJobs = groups.flatMap((group) => group.sortedJobs);
    const allJobIds = Array.from(new Set(groups.flatMap((group) => group.jobIds)));
    const allActions = groups.flatMap((group) =>
      group.mergedActionList.map((item) => ({
        advertId: group.advertId,
        nmId: group.nmId,
        clusterName: item.clusterName,
        desiredIsActive: item.desiredIsActive,
      })),
    );

    runtime.activateManualBidInteractiveWindow(
      reason === "apply-command" ? "action-write-pass" : "action-write-retry",
      reason === "apply-command"
        ? runtime.manualBidInteractiveWindowMs
        : runtime.retryBidInteractiveWindowMs,
    );

    const syncRunId = await this.wbClustersRepository.createSyncRun(
      reason === "apply-command" ? "manual" : "schedule",
    );
    const requestedAt = new Date().toISOString();

    try {
      await this.wbClustersRepository.upsertClusterActions(
        allActions.map((item) => ({
          advert_id: item.advertId,
          nm_id: item.nmId,
          norm_query: item.clusterName,
          desired_is_active: item.desiredIsActive,
          action_sync_status: "sending",
          action_retry_at: null,
          action_last_error: null,
        })),
      );

      const requestItems: ClusterActionMinusRequestItem[] = [];

      for (const group of groups) {
        const currentMinusPhrases = await this.wbClustersRepository.getCampaignMinusPhrases(
          group.advertId,
          group.nmId,
        );
        const nextMinusMap = new Map(
          currentMinusPhrases.map((item) => [runtime.normalizeAdvertisingText(item), item]),
        );

        for (const actionItem of group.mergedActionList) {
          if (actionItem.desiredIsActive) {
            nextMinusMap.delete(actionItem.normalizedClusterName);
          } else {
            nextMinusMap.set(actionItem.normalizedClusterName, actionItem.clusterName);
          }
        }

        requestItems.push({
          advert_id: group.advertId,
          nm_id: group.nmId,
          norm_queries: Array.from(nextMinusMap.values()).sort((left, right) =>
            left.localeCompare(right, "ru"),
          ),
        });
      }

      await this.wbClustersRepository.saveRawArchive({
        syncRunId,
        archiveType: "normquery-minus-set-request",
        advertId: null,
        nmId: null,
        payload: {
          direction: "outbound",
          entityType: "cluster-action",
          requestIntent: "queue-batch-set-cluster-action",
          requestedAt,
          queueReason: reason,
          jobIds: allJobIds,
          groupCount: groups.length,
          clusterCount: allActions.length,
          payload: {
            items: requestItems,
          },
        },
      });

      const attemptCount = await this.setNormQueryMinusWithQuickRetry(
        requestItems,
        runtime.isRecoverablePromotionError,
      );
      await this.wbClustersRepository.replaceCampaignMinusPhrases(
        requestItems.map((item) => ({
          advertId: item.advert_id,
          nmId: item.nm_id,
        })),
        requestItems,
      );
      await this.wbClustersRepository.upsertClusterActions(
        allActions.map((item) => ({
          advert_id: item.advertId,
          nm_id: item.nmId,
          norm_query: item.clusterName,
          desired_is_active: item.desiredIsActive,
          action_sync_status: "confirmed",
          action_retry_at: null,
          action_last_error: null,
        })),
      );
      await this.wbClustersRepository.completeClusterActionJobs(allJobIds);
      await this.wbClustersRepository.saveRawArchive({
        syncRunId,
        archiveType: "normquery-minus-set-result",
        advertId: null,
        nmId: null,
        payload: {
          direction: "outbound",
          entityType: "cluster-action",
          requestIntent: "queue-batch-set-cluster-action",
          responseResult: "accepted",
          respondedAt: new Date().toISOString(),
          attemptCount,
          groupCount: groups.length,
          clusterCount: allActions.length,
          queueReason: reason,
          jobIds: allJobIds,
        },
      });
      await this.wbClustersRepository.completeSyncRun(syncRunId, {
        status: "succeeded",
        campaignsSeen: groups.length,
        campaignsSynced: groups.length,
        productsSeen: groups.length,
        clustersUpserted: allActions.length,
        statsRowsUpserted: 0,
        errorMessage: "WB accepted the cluster action update; marked confirmed locally.",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown cluster action queue processing error";
      await this.wbClustersRepository.saveRawArchive({
        syncRunId,
        archiveType: "normquery-minus-set-error",
        advertId: null,
        nmId: null,
        payload: {
          direction: "outbound",
          entityType: "cluster-action",
          requestIntent: "queue-batch-set-cluster-action",
          responseResult: "failed",
          failedAt: new Date().toISOString(),
          queueReason: reason,
          jobIds: allJobIds,
          groupCount: groups.length,
          clusterCount: allActions.length,
          errorMessage,
        },
      });

      if (runtime.isRecoverablePromotionError(error)) {
        if (hasExceededClusterActionJobAttempts(allJobs, runtime.maxClusterActionJobAttempts)) {
          await this.wbClustersRepository.upsertClusterActions(
            allActions.map((item) => ({
              advert_id: item.advertId,
              nm_id: item.nmId,
              norm_query: item.clusterName,
              desired_is_active: item.desiredIsActive,
              action_sync_status: "failed",
              action_retry_at: null,
              action_last_error: errorMessage,
            })),
          );
          await this.wbClustersRepository.failClusterActionJobs(allJobIds, errorMessage);
          await this.wbClustersRepository.completeSyncRun(syncRunId, {
            status: "failed",
            campaignsSeen: groups.length,
            campaignsSynced: 0,
            productsSeen: groups.length,
            clustersUpserted: 0,
            statsRowsUpserted: 0,
            errorMessage,
          });
          return;
        }

        const retryDelayMs = getClusterActionJobRetryDelayMs(
          allJobs,
          getPromotionRetryDelayMs(error),
        );
        const retryAt = new Date(Date.now() + retryDelayMs).toISOString();
        const actionSyncStatus: ClusterActionSyncStatus =
          getRecoverableActionSyncStatus(error);
        await this.wbClustersRepository.upsertClusterActions(
          allActions.map((item) => ({
            advert_id: item.advertId,
            nm_id: item.nmId,
            norm_query: item.clusterName,
            desired_is_active: item.desiredIsActive,
            action_sync_status: actionSyncStatus,
            action_retry_at: retryAt,
            action_last_error: errorMessage,
          })),
        );
        await this.wbClustersRepository.rescheduleClusterActionJobs(allJobIds, {
          nextAttemptAt: retryAt,
          lastError: errorMessage,
        });
        await this.wbClustersRepository.completeSyncRun(syncRunId, {
          status: "succeeded",
          campaignsSeen: groups.length,
          campaignsSynced: 0,
          productsSeen: groups.length,
          clustersUpserted: 0,
          statsRowsUpserted: 0,
          errorMessage,
        });
        return;
      }

      await this.wbClustersRepository.upsertClusterActions(
        allActions.map((item) => ({
          advert_id: item.advertId,
          nm_id: item.nmId,
          norm_query: item.clusterName,
          desired_is_active: item.desiredIsActive,
          action_sync_status: "failed",
          action_retry_at: null,
          action_last_error: errorMessage,
        })),
      );
      await this.wbClustersRepository.failClusterActionJobs(allJobIds, errorMessage);
      await this.wbClustersRepository.completeSyncRun(syncRunId, {
        status: "failed",
        campaignsSeen: groups.length,
        campaignsSynced: 0,
        productsSeen: groups.length,
        clustersUpserted: 0,
        statsRowsUpserted: 0,
        errorMessage,
      });
    }
  }

  protected async setNormQueryMinusWithQuickRetry(
    items: ClusterActionMinusRequestItem[],
    isRecoverablePromotionError: (error: unknown) => boolean,
  ) {
    const retryDelaysMs = [0];
    let lastError: unknown = null;

    for (let attemptIndex = 0; attemptIndex < retryDelaysMs.length; attemptIndex += 1) {
      const delayMs = retryDelaysMs[attemptIndex] ?? 0;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        await this.wbPromotionApiClient.setNormQueryMinus(items, {
          failFastOnTooManyRequests: true,
          maxQueueWaitMs: 2_000,
        });
        return attemptIndex + 1;
      } catch (error) {
        lastError = error;
        if (!isRecoverablePromotionError(error) || attemptIndex === retryDelaysMs.length - 1) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new ServiceUnavailableException(
          "Не удалось применить изменение кластеров в WB Promotion API после быстрых повторов.",
        );
  }

}
