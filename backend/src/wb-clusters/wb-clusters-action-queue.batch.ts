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
import type { PromotionNormQueryMinusResponse } from "./types/promotion-api.types";

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
      // Read-back: «accepted» от WB ≠ «применено в кабинете». Перечитываем минус-набор и
      // сверяем с желаемым. По умолчанию режим «observe» — расхождение пишем в raw-archive, но
      // запись подтверждаем (накапливаем доказательства, что нормализация фраз WB совпадает с
      // нашей). Режим «enforce» (после проверки) уводит расхождение в ретрай. Сам get-minus
      // best-effort: если упал — не блокируем успешную запись.
      await this.verifyMinusReadback(requestItems, runtime, syncRunId);
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
      // Инвалидируем кэш чтобы следующий GET вернул новый статус кластера ("excluded"/"active").
      for (const nmId of new Set(groups.map((g) => g.nmId))) {
        runtime.invalidateSheetCaches(nmId);
      }
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
      // Частичный фейл: кампании, которые WB уже успел применить до сбоя, синхронизируем в
      // локальном зеркале — иначе ретрай пересоберёт их набор из устаревших данных и откатит
      // кабинет. set-minus у каждой кампании — полный replace-набор, поэтому write-back точечный.
      const appliedItems = (error as { appliedMinusItems?: ClusterActionMinusRequestItem[] })
        ?.appliedMinusItems;
      if (Array.isArray(appliedItems) && appliedItems.length > 0) {
        await this.wbClustersRepository.replaceCampaignMinusPhrases(
          appliedItems.map((item) => ({ advertId: item.advert_id, nmId: item.nm_id })),
          appliedItems,
        );
      }
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

  /**
   * Одна попытка set-minus всего батча. Повторы — НЕ здесь, а на уровне job-reschedule (с
   * backoff и учётом Retry-After), поэтому имя без «QuickRetry»: внутрипроходного быстрого
   * ретрая нет (он был мёртвым — массив задержек из одного нуля). Возвращает 1 (число попыток)
   * для совместимости с raw-archive `attemptCount`.
   */
  protected async setNormQueryMinusWithQuickRetry(
    items: ClusterActionMinusRequestItem[],
    _isRecoverablePromotionError: (error: unknown) => boolean,
  ) {
    await this.wbPromotionApiClient.setNormQueryMinus(items, {
      failFastOnTooManyRequests: true,
      maxQueueWaitMs: 2_000,
    });
    return 1;
  }

  /**
   * Read-back-верификация: перечитывает фактический минус-набор кампаний из WB и сверяет с
   * желаемым. Режим из WB_CLUSTER_ACTION_READBACK: "off" — выключено; "observe" (дефолт) —
   * расхождение пишем в raw-archive, но запись подтверждаем; "enforce" — расхождение бросает
   * recoverable ServiceUnavailable (ретрай, а не ложный confirmed). get-minus — best-effort:
   * его недоступность не блокирует подтверждение успешной записи.
   */
  protected async verifyMinusReadback(
    requestItems: ClusterActionMinusRequestItem[],
    runtime: ActionQueueRuntime,
    syncRunId: string,
  ): Promise<void> {
    const mode = (process.env.WB_CLUSTER_ACTION_READBACK ?? "observe").trim();
    if (mode === "off") return;

    let readback: PromotionNormQueryMinusResponse;
    try {
      readback = await this.wbPromotionApiClient.getNormQueryMinus(
        requestItems.map((item) => ({ advert_id: item.advert_id, nm_id: item.nm_id })),
      );
    } catch {
      return; // верификация — слой поверх записи, её сбой не блокирует подтверждение
    }

    const actualByKey = new Map(
      (readback.items ?? []).map((item) => [
        `${item.advert_id}:${item.nm_id}`,
        new Set((item.norm_queries ?? []).map((q) => runtime.normalizeAdvertisingText(q))),
      ]),
    );

    const mismatches: Array<{ advertId: number; nmId: number; desired: number; actual: number }> = [];
    for (const item of requestItems) {
      const desired = new Set(item.norm_queries.map((q) => runtime.normalizeAdvertisingText(q)));
      const actual = actualByKey.get(`${item.advert_id}:${item.nm_id}`) ?? new Set<string>();
      const matches = desired.size === actual.size && [...desired].every((q) => actual.has(q));
      if (!matches) {
        mismatches.push({
          advertId: item.advert_id,
          nmId: item.nm_id,
          desired: desired.size,
          actual: actual.size,
        });
      }
    }

    if (mismatches.length === 0) return;

    await this.wbClustersRepository.saveRawArchive({
      syncRunId,
      archiveType: "normquery-minus-readback-mismatch",
      advertId: null,
      nmId: null,
      payload: {
        direction: "inbound",
        entityType: "cluster-action",
        requestIntent: "verify-cluster-action-readback",
        respondedAt: new Date().toISOString(),
        readbackMode: mode,
        mismatches,
      },
    });

    if (mode === "enforce") {
      const first = mismatches[0];
      throw new ServiceUnavailableException(
        `WB read-back: минус-набор кампании ${first.advertId}/${first.nmId} не совпал с желаемым ` +
          `(ожидали ${first.desired} фраз, в кабинете ${first.actual}; всего расхождений ${mismatches.length}) — помечаю на повтор.`,
      );
    }
  }
}
