import { ServiceUnavailableException } from "@nestjs/common";

import {
  buildMergedClusterBidList,
  getClusterBidJobRetryDelayMs,
  getPromotionRetryDelayMs,
  getRecoverableBidSyncStatus,
  hasExceededClusterBidJobAttempts,
  normalizeBidForWb,
} from "./wb-clusters-queue.helpers";
import { WbClustersBidQueueWriteRuntime } from "./wb-clusters-bid-queue.write-runtime";
import type { BidQueueRuntime, ClusterBidWriteGroup } from "./wb-clusters-bid-queue.types";
import type { PromotionSetNormQueryBidsRequest } from "./wb-clusters.types";

export abstract class WbClustersBidQueueWriteGroupHandler extends WbClustersBidQueueWriteRuntime {
  protected async processWriteJobGroup(
    group: ClusterBidWriteGroup,
    reason: "apply-command" | "cron",
    runtime: BidQueueRuntime,
  ) {
    const sortedJobs = [...group.jobs].sort((left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt),
    );
    runtime.activateManualBidInteractiveWindow(
      reason === "apply-command" ? "write-pass" : "write-retry",
      reason === "apply-command"
        ? runtime.manualBidInteractiveWindowMs
        : runtime.retryBidInteractiveWindowMs,
    );
    const mergedBidList = buildMergedClusterBidList(sortedJobs);
    const jobIds = sortedJobs.map((job) => job.jobId);
    const syncRunId = await this.wbClustersRepository.createSyncRun(
      reason === "apply-command" ? "manual" : "schedule",
    );
    const requestedAt = new Date().toISOString();

    try {
      if (mergedBidList.length === 0) {
        await this.wbClustersRepository.failClusterBidJobs(
          jobIds,
          "No active cluster bid items remained for processing.",
        );
        await this.wbClustersRepository.completeSyncRun(syncRunId, {
          status: "failed",
          campaignsSeen: 1,
          campaignsSynced: 0,
          productsSeen: 1,
          clustersUpserted: 0,
          statsRowsUpserted: 0,
          errorMessage: "No active cluster bid items remained for processing.",
        });
        return;
      }

      await this.wbClustersRepository.upsertClusterBids(
        mergedBidList.map((item) => ({
          advert_id: group.advertId,
          nm_id: group.nmId,
          norm_query: item.clusterName,
          bid: item.bid,
          bid_sync_status: "sending",
          bid_confirmed_at: null,
          bid_retry_at: null,
          bid_last_error: null,
        })),
      );

      const mergedBidChunks = this.chunkArray(mergedBidList, 100);

      for (let batchIndex = 0; batchIndex < mergedBidChunks.length; batchIndex += 1) {
        const batch = mergedBidChunks[batchIndex] ?? [];
        const wbRequest: PromotionSetNormQueryBidsRequest = {
          bids: batch.map((item) => ({
            advert_id: group.advertId,
            nm_id: group.nmId,
            norm_query: item.clusterName,
            bid: normalizeBidForWb(item.bid),
          })),
        };
        await this.wbClustersRepository.saveRawArchive({
          syncRunId,
          archiveType: "normquery-bids-set-request",
          advertId: group.advertId,
          nmId: group.nmId,
          payload: {
            direction: "outbound",
            entityType: "cluster-bid",
            requestIntent: "queue-batch-set-manual-bid",
            requestedAt,
            queueReason: reason,
            jobIds,
            batchIndex: batchIndex + 1,
            batchCount: mergedBidChunks.length,
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
          advertId: group.advertId,
          nmId: group.nmId,
          payload: {
            direction: "outbound",
            entityType: "cluster-bid",
            requestIntent: "queue-batch-set-manual-bid",
            responseResult: "accepted",
            respondedAt: new Date().toISOString(),
            clusterCount: batch.length,
            attemptCount: setBidAttemptCount,
            queueReason: reason,
            jobIds,
            batchIndex: batchIndex + 1,
            batchCount: mergedBidChunks.length,
          },
        });
      }

      // Read-back: «accepted» ≠ «применено». Сверяем фактические ставки с желаемыми перед
      // confirmed (режим WB_CLUSTER_BID_READBACK, дефолт observe). Включается сам при выходе
      // ставок из dry-run — отдельной доводки на запуске не требуется.
      await this.verifyBidReadback(
        mergedBidList.map((item) => ({
          advertId: group.advertId,
          nmId: group.nmId,
          clusterName: item.clusterName,
          bid: item.bid,
        })),
        runtime,
        syncRunId,
      );

      const confirmedAt = new Date().toISOString();
      await this.wbClustersRepository.upsertClusterBids(
        mergedBidList.map((item) => ({
          advert_id: group.advertId,
          nm_id: group.nmId,
          norm_query: item.clusterName,
          bid: item.bid,
          bid_sync_status: "confirmed",
          bid_confirmed_at: confirmedAt,
          bid_retry_at: null,
          bid_last_error: null,
        })),
      );
      await this.wbClustersRepository.completeClusterBidJobs(jobIds);
      await this.wbClustersRepository.completeSyncRun(syncRunId, {
        status: "succeeded",
        campaignsSeen: 1,
        campaignsSynced: 1,
        productsSeen: 1,
        clustersUpserted: mergedBidList.length,
        statsRowsUpserted: 0,
        errorMessage: "WB accepted the bid update; marked confirmed locally.",
      });
      // Инвалидируем кэш чтобы следующий GET вернул статус "confirmed" и новую ставку.
      runtime.invalidateSheetCaches(group.nmId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown cluster bid queue processing error";
      await this.wbClustersRepository.saveRawArchive({
        syncRunId,
        archiveType: "normquery-bids-set-error",
        advertId: group.advertId,
        nmId: group.nmId,
        payload: {
          direction: "outbound",
          entityType: "cluster-bid",
          requestIntent: "queue-batch-set-manual-bid",
          responseResult: "failed",
          failedAt: new Date().toISOString(),
          queueReason: reason,
          jobIds,
          errorMessage,
        },
      });

      if (runtime.isRecoverablePromotionError(error)) {
        if (hasExceededClusterBidJobAttempts(sortedJobs, runtime.maxClusterBidJobAttempts)) {
          await this.wbClustersRepository.upsertClusterBids(
            mergedBidList.map((item) => ({
              advert_id: group.advertId,
              nm_id: group.nmId,
              norm_query: item.clusterName,
              bid: item.bid,
              bid_sync_status: "failed",
              bid_confirmed_at: null,
              bid_retry_at: null,
              bid_last_error: errorMessage,
            })),
          );
          await this.wbClustersRepository.failClusterBidJobs(jobIds, errorMessage);
          await this.wbClustersRepository.completeSyncRun(syncRunId, {
            status: "failed",
            campaignsSeen: 1,
            campaignsSynced: 0,
            productsSeen: 1,
            clustersUpserted: 0,
            statsRowsUpserted: 0,
            errorMessage: `WB retry limit exceeded: ${errorMessage}`,
          });
          return;
        }

        const nextAttemptAt = new Date(
          Date.now() +
            getClusterBidJobRetryDelayMs(
              sortedJobs,
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
          processingPhase: "write",
          itemStatus: "retry_scheduled",
        });
        await this.wbClustersRepository.completeSyncRun(syncRunId, {
          status: "succeeded",
          campaignsSeen: 1,
          campaignsSynced: 0,
          productsSeen: 1,
          clustersUpserted: mergedBidList.length,
          statsRowsUpserted: 0,
          errorMessage: `WB rate limit, retry scheduled: ${errorMessage}`,
        });
        return;
      }

      await this.wbClustersRepository.upsertClusterBids(
        mergedBidList.map((item) => ({
          advert_id: group.advertId,
          nm_id: group.nmId,
          norm_query: item.clusterName,
          bid: item.bid,
          bid_sync_status: "failed",
          bid_confirmed_at: null,
          bid_retry_at: null,
          bid_last_error: errorMessage,
        })),
      );
      await this.wbClustersRepository.failClusterBidJobs(jobIds, errorMessage);
      await this.wbClustersRepository.completeSyncRun(syncRunId, {
        status: "failed",
        campaignsSeen: 1,
        campaignsSynced: 0,
        productsSeen: 1,
        clustersUpserted: 0,
        statsRowsUpserted: 0,
        errorMessage,
      });
    }
  }

  /**
   * Read-back ставок: перечитывает фактические ставки кампаний из WB (get-bids) и сверяет с
   * желаемыми. Режим из WB_CLUSTER_BID_READBACK: "off" — выкл; "observe" (дефолт) — расхождение
   * пишем в raw-archive, но запись подтверждаем; "enforce" — расхождение → recoverable-ретрай
   * (а не ложный confirmed). В dry-run ставки не пишутся → метод не вызывается; включается сам,
   * как только снят WB_CLUSTER_BID_DRY_RUN. get-bids — best-effort: сбой не блокирует подтверждение.
   */
  protected async verifyBidReadback(
    items: Array<{ advertId: number; nmId: number; clusterName: string; bid: number }>,
    runtime: BidQueueRuntime,
    syncRunId: string,
  ): Promise<void> {
    const mode = (process.env.WB_CLUSTER_BID_READBACK ?? "observe").trim();
    if (mode === "off" || items.length === 0) return;

    const campaigns = Array.from(
      new Map(
        items.map((i) => [`${i.advertId}:${i.nmId}`, { advert_id: i.advertId, nm_id: i.nmId }]),
      ).values(),
    );

    let readbackBids: ReturnType<BidQueueRuntime["normalizeNormQueryBidsFromWb"]>;
    try {
      const response = await this.wbPromotionApiClient.getNormQueryBids(campaigns, {
        failFastOnTooManyRequests: true,
        maxQueueWaitMs: 5_000,
      });
      readbackBids = runtime.normalizeNormQueryBidsFromWb(response.bids ?? []);
    } catch {
      return; // верификация — слой поверх записи, её сбой не блокирует подтверждение
    }

    const actualByKey = new Map(
      readbackBids.map((item) => [
        `${item.advert_id}:${item.nm_id}:${runtime.normalizeAdvertisingText(item.norm_query)}`,
        typeof item.bid === "number" ? item.bid : null,
      ]),
    );

    const mismatches: Array<{
      advertId: number;
      nmId: number;
      clusterName: string;
      desired: number;
      actual: number | null;
    }> = [];
    for (const item of items) {
      const key = `${item.advertId}:${item.nmId}:${runtime.normalizeAdvertisingText(item.clusterName)}`;
      const desired = normalizeBidForWb(item.bid);
      const actual = actualByKey.get(key) ?? null;
      if (actual !== desired) {
        mismatches.push({
          advertId: item.advertId,
          nmId: item.nmId,
          clusterName: item.clusterName,
          desired,
          actual,
        });
      }
    }

    if (mismatches.length === 0) return;

    await this.wbClustersRepository.saveRawArchive({
      syncRunId,
      archiveType: "normquery-bids-readback-mismatch",
      advertId: null,
      nmId: null,
      payload: {
        direction: "inbound",
        entityType: "cluster-bid",
        requestIntent: "verify-cluster-bid-readback",
        respondedAt: new Date().toISOString(),
        readbackMode: mode,
        mismatchCount: mismatches.length,
        mismatches: mismatches.slice(0, 50),
      },
    });

    if (mode === "enforce") {
      const first = mismatches[0];
      throw new ServiceUnavailableException(
        `WB read-back ставок: кампания ${first.advertId}/${first.nmId} кластер "${first.clusterName}" — ` +
          `желаемая ${first.desired}, в кабинете ${first.actual ?? "нет"} (всего расхождений ${mismatches.length}) — помечаю на повтор.`,
      );
    }
  }
}
