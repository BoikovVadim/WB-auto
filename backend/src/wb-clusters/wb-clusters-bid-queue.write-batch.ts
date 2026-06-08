import {
  getClusterBidJobRetryDelayMs,
  getPromotionRetryDelayMs,
  getRecoverableBidSyncStatus,
  hasExceededClusterBidJobAttempts,
  normalizeBidForWb,
} from "./wb-clusters-queue.helpers";
import { WbClustersBidQueueWriteGroupHandler } from "./wb-clusters-bid-queue.write-group";
import type { BidQueueRuntime, PreparedClusterBidWriteGroup } from "./wb-clusters-bid-queue.types";
import type { PromotionSetNormQueryBidsRequest } from "./wb-clusters.types";

export abstract class WbClustersBidQueueWriteBatch extends WbClustersBidQueueWriteGroupHandler {
  protected async processWriteMultiGroupBatch(
    groups: PreparedClusterBidWriteGroup[],
    reason: "apply-command" | "cron",
    runtime: BidQueueRuntime,
  ) {
    const flattenedBids = groups.flatMap((group) =>
      group.mergedBidList.map((item) => ({
        advertId: group.advertId,
        nmId: group.nmId,
        clusterName: item.clusterName,
        bid: item.bid,
      })),
    );
    const allJobIds = Array.from(new Set(groups.flatMap((group) => group.jobIds)));
    const allJobs = groups.flatMap((group) => group.sortedJobs);

    runtime.activateManualBidInteractiveWindow(
      reason === "apply-command" ? "write-pass" : "write-retry",
      reason === "apply-command"
        ? runtime.manualBidInteractiveWindowMs
        : runtime.retryBidInteractiveWindowMs,
    );

    const syncRunId = await this.wbClustersRepository.createSyncRun(
      reason === "apply-command" ? "manual" : "schedule",
    );
    const requestedAt = new Date().toISOString();

    try {
      await this.wbClustersRepository.upsertClusterBids(
        flattenedBids.map((item) => ({
          advert_id: item.advertId,
          nm_id: item.nmId,
          norm_query: item.clusterName,
          bid: item.bid,
          bid_sync_status: "sending",
          bid_confirmed_at: null,
          bid_retry_at: null,
          bid_last_error: null,
        })),
      );

      const wbRequest: PromotionSetNormQueryBidsRequest = {
        bids: flattenedBids.map((item) => ({
          advert_id: item.advertId,
          nm_id: item.nmId,
          norm_query: item.clusterName,
          bid: normalizeBidForWb(item.bid),
        })),
      };
      await this.wbClustersRepository.saveRawArchive({
        syncRunId,
        archiveType: "normquery-bids-set-request",
        advertId: null,
        nmId: null,
        payload: {
          direction: "outbound",
          entityType: "cluster-bid",
          requestIntent: "queue-batch-set-manual-bid",
          requestedAt,
          queueReason: reason,
          jobIds: allJobIds,
          groupCount: groups.length,
          clusterCount: flattenedBids.length,
          payload: wbRequest,
        },
      });

      const setBidAttemptCount = await this.setNormQueryBidsWithQuickRetry(
        wbRequest,
        runtime.isRecoverablePromotionError,
      );
      await this.wbClustersRepository.saveRawArchive({
        syncRunId,
        archiveType: "normquery-bids-set-result",
        advertId: null,
        nmId: null,
        payload: {
          direction: "outbound",
          entityType: "cluster-bid",
          requestIntent: "queue-batch-set-manual-bid",
          responseResult: "accepted",
          respondedAt: new Date().toISOString(),
          clusterCount: flattenedBids.length,
          groupCount: groups.length,
          attemptCount: setBidAttemptCount,
          queueReason: reason,
          jobIds: allJobIds,
        },
      });

      // Read-back перед confirmed (см. verifyBidReadback / WB_CLUSTER_BID_READBACK).
      await this.verifyBidReadback(flattenedBids, runtime, syncRunId);

      const confirmedAt = new Date().toISOString();
      await this.wbClustersRepository.upsertClusterBids(
        flattenedBids.map((item) => ({
          advert_id: item.advertId,
          nm_id: item.nmId,
          norm_query: item.clusterName,
          bid: item.bid,
          bid_sync_status: "confirmed",
          bid_confirmed_at: confirmedAt,
          bid_retry_at: null,
          bid_last_error: null,
        })),
      );
      await this.wbClustersRepository.completeClusterBidJobs(allJobIds);
      await this.wbClustersRepository.completeSyncRun(syncRunId, {
        status: "succeeded",
        campaignsSeen: groups.length,
        campaignsSynced: groups.length,
        productsSeen: groups.length,
        clustersUpserted: flattenedBids.length,
        statsRowsUpserted: 0,
        errorMessage: "WB accepted the batched bid update; marked confirmed locally.",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown cluster bid queue processing error";
      await this.wbClustersRepository.saveRawArchive({
        syncRunId,
        archiveType: "normquery-bids-set-error",
        advertId: null,
        nmId: null,
        payload: {
          direction: "outbound",
          entityType: "cluster-bid",
          requestIntent: "queue-batch-set-manual-bid",
          responseResult: "failed",
          failedAt: new Date().toISOString(),
          queueReason: reason,
          jobIds: allJobIds,
          groupCount: groups.length,
          clusterCount: flattenedBids.length,
          errorMessage,
        },
      });

      if (runtime.isRecoverablePromotionError(error)) {
        if (hasExceededClusterBidJobAttempts(allJobs, runtime.maxClusterBidJobAttempts)) {
          await this.wbClustersRepository.upsertClusterBids(
            flattenedBids.map((item) => ({
              advert_id: item.advertId,
              nm_id: item.nmId,
              norm_query: item.clusterName,
              bid: item.bid,
              bid_sync_status: "failed",
              bid_confirmed_at: null,
              bid_retry_at: null,
              bid_last_error: errorMessage,
            })),
          );
          await this.wbClustersRepository.failClusterBidJobs(allJobIds, errorMessage);
          await this.wbClustersRepository.completeSyncRun(syncRunId, {
            status: "failed",
            campaignsSeen: groups.length,
            campaignsSynced: 0,
            productsSeen: groups.length,
            clustersUpserted: 0,
            statsRowsUpserted: 0,
            errorMessage: `WB retry limit exceeded: ${errorMessage}`,
          });
          return;
        }

        const nextAttemptAt = new Date(
          Date.now() +
            getClusterBidJobRetryDelayMs(
              allJobs,
              getPromotionRetryDelayMs(error),
            ),
        ).toISOString();
        await this.wbClustersRepository.upsertClusterBids(
          flattenedBids.map((item) => ({
            advert_id: item.advertId,
            nm_id: item.nmId,
            norm_query: item.clusterName,
            bid: item.bid,
            bid_sync_status: getRecoverableBidSyncStatus(error),
            bid_confirmed_at: null,
            bid_retry_at: nextAttemptAt,
            bid_last_error: errorMessage,
          })),
        );
        await this.wbClustersRepository.rescheduleClusterBidJobs(allJobIds, {
          nextAttemptAt,
          lastError: errorMessage,
          processingPhase: "write",
          itemStatus: "retry_scheduled",
        });
        await this.wbClustersRepository.completeSyncRun(syncRunId, {
          status: "succeeded",
          campaignsSeen: groups.length,
          campaignsSynced: 0,
          productsSeen: groups.length,
          clustersUpserted: flattenedBids.length,
          statsRowsUpserted: 0,
          errorMessage: `WB rate limit, retry scheduled: ${errorMessage}`,
        });
        return;
      }

      await this.wbClustersRepository.upsertClusterBids(
        flattenedBids.map((item) => ({
          advert_id: item.advertId,
          nm_id: item.nmId,
          norm_query: item.clusterName,
          bid: item.bid,
          bid_sync_status: "failed",
          bid_confirmed_at: null,
          bid_retry_at: null,
          bid_last_error: errorMessage,
        })),
      );
      await this.wbClustersRepository.failClusterBidJobs(allJobIds, errorMessage);
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

}
