import { ServiceUnavailableException } from "@nestjs/common";

import {
  buildMergedClusterBidList,
  getClusterBidReadbackRetryDelayMs,
  getPromotionRetryDelayMs,
  getRecoverableBidSyncStatus,
} from "./wb-clusters-queue.helpers";
import { WbClustersBidQueueWrite } from "./wb-clusters-bid-queue.write";
import type { BidQueueRuntime, ClusterBidReconcileGroup } from "./wb-clusters-bid-queue.types";

export abstract class WbClustersBidQueueReconcile extends WbClustersBidQueueWrite {
  async processReconcilePass(runtime: BidQueueRuntime) {
    while (true) {
      const claimedJobs = await this.wbClustersRepository.claimReadyClusterBidReconcileJobs(
        runtime.maxBidJobsPerPass,
      );
      if (claimedJobs.length === 0) {
        return;
      }

      const groupedJobs = new Map<string, ClusterBidReconcileGroup>();

      for (const claimedJob of claimedJobs) {
        const groupKey = `${claimedJob.advertId}:${claimedJob.nmId}`;
        const existingGroup = groupedJobs.get(groupKey);
        if (existingGroup) {
          existingGroup.jobs.push(claimedJob);
          continue;
        }

        groupedJobs.set(groupKey, {
          advertId: claimedJob.advertId,
          nmId: claimedJob.nmId,
          jobs: [claimedJob],
        });
      }

      for (const group of groupedJobs.values()) {
        await this.processReconcileGroup(group, runtime);
      }
    }
  }

  private async processReconcileGroup(
    group: ClusterBidReconcileGroup,
    runtime: BidQueueRuntime,
  ) {
    const syncRunId = await this.wbClustersRepository.createSyncRun("schedule");
    const sortedJobs = [...group.jobs].sort((left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt),
    );
    const mergedBidList = buildMergedClusterBidList(sortedJobs);
    const jobIds = sortedJobs.map((job) => job.jobId);

    try {
      const quickReadbackRetryDelaysMs = [0, 2_000, 5_000];
      let confirmedBids: Array<{ clusterName: string; bid: number }> = [];

      for (let attemptIndex = 0; attemptIndex < quickReadbackRetryDelaysMs.length; attemptIndex += 1) {
        const delayMs = quickReadbackRetryDelaysMs[attemptIndex] ?? 0;
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        const readbackResponse = await this.getNormQueryBidsWithQuickRetry(
          [{ advert_id: group.advertId, nm_id: group.nmId }],
          runtime.isRecoverablePromotionError,
        );
        await this.wbClustersRepository.saveRawArchive({
          syncRunId,
          archiveType: "normquery-bids-readback",
          advertId: group.advertId,
          nmId: group.nmId,
          payload: {
            attemptIndex: attemptIndex + 1,
            attemptCount: quickReadbackRetryDelaysMs.length,
            response: readbackResponse,
          },
        });

        const normalizedReadbackBids = runtime.normalizeNormQueryBidsFromWb(
          readbackResponse.bids ?? [],
        );
        const readbackMap = new Map(
          normalizedReadbackBids.map((item) => [
            runtime.normalizeAdvertisingText(item.norm_query),
            typeof item.bid === "number" ? item.bid : null,
          ]),
        );

        confirmedBids = mergedBidList.filter((item) => {
          const readbackBid = readbackMap.get(runtime.normalizeAdvertisingText(item.clusterName));
          return typeof readbackBid === "number" && readbackBid === item.bid;
        });

        if (confirmedBids.length === mergedBidList.length) {
          break;
        }
      }

      if (confirmedBids.length > 0) {
        await this.wbClustersRepository.upsertClusterBids(
          confirmedBids.map((item) => ({
            advert_id: group.advertId,
            nm_id: group.nmId,
            norm_query: item.clusterName,
            bid: item.bid,
            bid_sync_status: "confirmed",
            bid_confirmed_at: new Date().toISOString(),
            bid_retry_at: null,
            bid_last_error: null,
          })),
        );
      }

      const unresolvedBids = mergedBidList.filter(
        (item) =>
          !confirmedBids.some(
            (confirmedBid) =>
              runtime.normalizeAdvertisingText(confirmedBid.clusterName) ===
              runtime.normalizeAdvertisingText(item.clusterName),
          ),
      );

      if (unresolvedBids.length > 0) {
        if (Math.max(...sortedJobs.map((job) => job.attemptCount), 1) >= runtime.maxClusterBidJobAttempts) {
          await this.wbClustersRepository.upsertClusterBids(
            unresolvedBids.map((item) => ({
              advert_id: group.advertId,
              nm_id: group.nmId,
              norm_query: item.clusterName,
              bid: item.bid,
              bid_sync_status: "failed",
              bid_confirmed_at: null,
              bid_retry_at: null,
              bid_last_error: "WB did not confirm cluster bids after repeated readback attempts.",
            })),
          );
          await this.wbClustersRepository.failClusterBidJobs(
            jobIds,
            "WB did not confirm cluster bids after repeated readback attempts.",
          );
          await this.wbClustersRepository.completeSyncRun(syncRunId, {
            status: "failed",
            campaignsSeen: 1,
            campaignsSynced: 0,
            productsSeen: 1,
            clustersUpserted: 0,
            statsRowsUpserted: 0,
            errorMessage: "WB did not confirm cluster bids after repeated readback attempts.",
          });
          return;
        }

        const nextAttemptAt = new Date(
          Date.now() + getClusterBidReadbackRetryDelayMs(jobIds.length),
        ).toISOString();
        await this.wbClustersRepository.upsertClusterBids(
          unresolvedBids.map((item) => ({
            advert_id: group.advertId,
            nm_id: group.nmId,
            norm_query: item.clusterName,
            bid: item.bid,
            bid_sync_status: "pending",
            bid_confirmed_at: null,
            bid_retry_at: nextAttemptAt,
            bid_last_error: "WB did not confirm all requested cluster bids yet.",
          })),
        );
        await this.wbClustersRepository.rescheduleClusterBidJobs(jobIds, {
          nextAttemptAt,
          lastError: "WB did not confirm all requested cluster bids yet.",
          processingPhase: "reconcile",
          itemStatus: "retry_scheduled",
        });
        await this.wbClustersRepository.completeSyncRun(syncRunId, {
          status: "succeeded",
          campaignsSeen: 1,
          campaignsSynced: 0,
          productsSeen: 1,
          clustersUpserted: unresolvedBids.length,
          statsRowsUpserted: 0,
          errorMessage: "WB did not confirm all requested cluster bids yet.",
        });
        return;
      }

      await this.wbClustersRepository.completeClusterBidJobs(jobIds);
      await this.wbClustersRepository.completeSyncRun(syncRunId, {
        status: "succeeded",
        campaignsSeen: 1,
        campaignsSynced: 1,
        productsSeen: 1,
        clustersUpserted: mergedBidList.length,
        statsRowsUpserted: 0,
        errorMessage: null,
      });
      // Инвалидируем кэш после подтверждения от WB — следующий GET вернёт "confirmed".
      runtime.invalidateSheetCaches(group.nmId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown cluster bid reconcile error";
      await this.wbClustersRepository.saveRawArchive({
        syncRunId,
        archiveType: "normquery-bids-readback-error",
        advertId: group.advertId,
        nmId: group.nmId,
        payload: {
          direction: "inbound",
          entityType: "cluster-bid",
          requestIntent: "queue-batch-readback",
          responseResult: "failed",
          failedAt: new Date().toISOString(),
          jobIds,
          errorMessage,
        },
      });
      const nextAttemptAt = new Date(
        Date.now() +
          getClusterBidReadbackRetryDelayMs(
            jobIds.length,
            getPromotionRetryDelayMs(error),
          ),
      ).toISOString();
      await this.wbClustersRepository.upsertClusterBids(
        mergedBidList.map((item) => ({
          advert_id: group.advertId,
          nm_id: group.nmId,
          norm_query: item.clusterName,
          bid: item.bid,
          bid_sync_status: getRecoverableBidSyncStatus(error),
          bid_confirmed_at: null,
          bid_retry_at: nextAttemptAt,
          bid_last_error: errorMessage,
        })),
      );
      await this.wbClustersRepository.rescheduleClusterBidJobs(jobIds, {
        nextAttemptAt,
        lastError: errorMessage,
        processingPhase: "reconcile",
        itemStatus: "retry_scheduled",
      });
      await this.wbClustersRepository.completeSyncRun(syncRunId, {
        status: "succeeded",
        campaignsSeen: 1,
        campaignsSynced: 0,
        productsSeen: 1,
        clustersUpserted: mergedBidList.length,
        statsRowsUpserted: 0,
        errorMessage,
      });
    }
  }

  private async getNormQueryBidsWithQuickRetry(
    items: Array<{ advert_id: number; nm_id: number }>,
    isRecoverablePromotionError: (error: unknown) => boolean,
  ) {
    const retryDelaysMs = [0, 1_000, 2_500];
    let lastError: unknown = null;

    for (let attemptIndex = 0; attemptIndex < retryDelaysMs.length; attemptIndex += 1) {
      const delayMs = retryDelaysMs[attemptIndex] ?? 0;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        return await this.wbPromotionApiClient.getNormQueryBids(items, {
          failFastOnTooManyRequests: true,
          maxQueueWaitMs: 5_000,
        });
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
          "Не удалось перечитать ставки WB Promotion API после быстрых повторов.",
        );
  }

}
