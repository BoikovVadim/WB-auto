import { Inject, Injectable } from "@nestjs/common";

import { WbApiClient } from "../wb-sync/wb-api.client";
import { WbRuntimeConfigService } from "../wb-sync/wb-runtime-config.service";
import { WbCabinetPrivateApiClient } from "./wb-cabinet-private-api.client";
import { WbCmpSafariClient } from "./wb-cmp-safari.client";
import { ProductAdvertisingReadRepository } from "./product-advertising-read.repository";
import { ProductAdvertisingSnapshotJobService } from "./product-advertising-snapshot-job.service";
import { ProductAdvertisingSnapshotMaterializer } from "./product-advertising-snapshot.materializer";
import { ProductAdvertisingSnapshotResolver } from "./product-advertising-snapshot.resolver";
import { ProductAdvertisingWorkspaceReadService } from "./product-advertising-workspace-read.service";
import { ProductWorkspaceSnapshotResolver } from "./product-workspace-snapshot.resolver";
import { ProductPresetSnapshotOrchestratorService } from "./product-preset-snapshot-orchestrator.service";
import { PromotionSyncRepository } from "./promotion-sync.repository";
import { WbClustersActionQueueService } from "./wb-clusters-action-queue.service";
import { WbClustersBidQueueService } from "./wb-clusters-bid-queue.service";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbClustersSyncOrchestratorService } from "./wb-clusters-sync-orchestrator.service";
import type {
  ClusterSyncMode,
  ClusterSyncTrigger,
  ProductAdvertisingClusterAction,
  ProductAdvertisingClusterActionResponse,
  ProductAdvertisingClusterBidUpdateResponse,
  ProductAdvertisingRefreshStartResponse,
  ProductAdvertisingRefreshStatusResponse,
  ProductAdvertisingSheetResponse,
  ProductAdvertisingWorkspaceClusterSortDirection,
  ProductAdvertisingWorkspaceClusterSortKey,
  ProductAdvertisingWorkspaceResponse,
  ProductClusterLookupResponse,
  ProductSnapshotReadinessResponse,
  ProductSnapshotWarmupPriority,
  WbClustersStatusResponse,
  WbClustersSyncStartResponse,
} from "./wb-clusters.types";
import * as wb_clusters_command_flow from "./wb-clusters-command-flow";
import * as wb_clusters_read_flow from "./wb-clusters-read-flow";
import * as wb_clusters_sync_flow from "./wb-clusters-sync-flow";
import { WbPromotionApiClient } from "./wb-promotion-api.client";
import type {
  WbClustersMaterializeContext,
  WbClustersSnapshotReadContext,
  WbClustersWriteLanesContext,
} from "./wb-clusters.flow-context";
import { WbClustersServiceSyncInternals } from "./wb-clusters.service.sync-internals";

@Injectable()
export class WbClustersService extends WbClustersServiceSyncInternals {
  constructor(
    @Inject(WbCabinetPrivateApiClient)
    protected readonly wbCabinetPrivateApiClient: WbCabinetPrivateApiClient,
    @Inject(WbPromotionApiClient)
    protected readonly wbPromotionApiClient: WbPromotionApiClient,
    @Inject(WbApiClient)
    protected readonly wbApiClient: WbApiClient,
    @Inject(WbCmpSafariClient)
    protected readonly wbCmpSafariClient: WbCmpSafariClient,
    @Inject(WbClustersRepository)
    protected readonly wbClustersRepository: WbClustersRepository,
    @Inject(PromotionSyncRepository)
    protected readonly promotionSyncRepository: PromotionSyncRepository,
    @Inject(ProductAdvertisingReadRepository)
    protected readonly productAdvertisingReadRepository: ProductAdvertisingReadRepository,
    @Inject(ProductAdvertisingSnapshotResolver)
    protected readonly productAdvertisingSnapshotResolver: ProductAdvertisingSnapshotResolver,
    @Inject(ProductAdvertisingSnapshotMaterializer)
    protected readonly productAdvertisingSnapshotMaterializer: ProductAdvertisingSnapshotMaterializer,
    @Inject(ProductAdvertisingSnapshotJobService)
    protected readonly productAdvertisingSnapshotJobService: ProductAdvertisingSnapshotJobService,
    @Inject(ProductAdvertisingWorkspaceReadService)
    protected readonly productAdvertisingWorkspaceReadService: ProductAdvertisingWorkspaceReadService,
    @Inject(ProductWorkspaceSnapshotResolver)
    protected readonly productWorkspaceSnapshotResolver: ProductWorkspaceSnapshotResolver,
    @Inject(WbRuntimeConfigService)
    protected readonly wbRuntimeConfigService: WbRuntimeConfigService,
    @Inject(ProductPresetSnapshotOrchestratorService)
    protected readonly productPresetSnapshotOrchestratorService: ProductPresetSnapshotOrchestratorService,
    @Inject(WbClustersSyncOrchestratorService)
    protected readonly wbClustersSyncOrchestratorService: WbClustersSyncOrchestratorService,
    @Inject(WbClustersActionQueueService)
    protected readonly wbClustersActionQueueService: WbClustersActionQueueService,
    @Inject(WbClustersBidQueueService)
    protected readonly wbClustersBidQueueService: WbClustersBidQueueService,
  ) {
    super();
  }

  async getStatus(): Promise<WbClustersStatusResponse> {
    return wb_clusters_sync_flow.getStatus(this) as Promise<WbClustersStatusResponse>;
  }

  async runSync(
    trigger: ClusterSyncTrigger = "manual",
    mode: ClusterSyncMode = "full",
  ): Promise<WbClustersSyncStartResponse> {
    return wb_clusters_sync_flow.runSync(this, trigger, mode) as Promise<WbClustersSyncStartResponse>;
  }

  async runStatsHistoricalBackfill(): Promise<{ accepted: boolean; message: string; period: { from: string; to: string } }> {
    const period = this.getStatsBackfillPeriod();
    const syncRunId = `stats-backfill-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    // Run in background — returns immediately, backfill runs async
    this.runStatsBackfillPhase(syncRunId)
      .then((result) => {
        this.logger.log(
          `Stats backfill completed: ${result.statsRowsUpserted} rows upserted, ` +
          `${result.warningMessages.length} warnings, period ${period.from}–${period.to}`,
        );
      })
      .catch((err: Error) => {
        this.logger.error(`Stats backfill failed: ${err.message}`);
      });
    return {
      accepted: true,
      message: `Stats backfill started for period ${period.from} – ${period.to}. Runs in background (~2-3 min).`,
      period,
    };
  }

  async lookupProductClusters(
    nmId: number,
    queries: string[],
  ): Promise<ProductClusterLookupResponse> {
    return wb_clusters_sync_flow.lookupProductClusters(this, nmId, queries);
  }

  async getProductAdvertisingSheet(
    nmId: number,
    input?: {
      startDate?: string;
      endDate?: string;
    },
  ): Promise<ProductAdvertisingSheetResponse> {
    return wb_clusters_read_flow.getProductAdvertisingSheet(
      this as unknown as WbClustersSnapshotReadContext,
      nmId,
      input,
    );
  }

  async getProductAdvertisingWorkspace(
    nmId: number,
    input?: {
      startDate?: string;
      endDate?: string;
    },
  ): Promise<ProductAdvertisingWorkspaceResponse> {
    return wb_clusters_read_flow.getProductAdvertisingWorkspace(
      this as unknown as WbClustersSnapshotReadContext,
      nmId,
      input,
    );
  }

  async getProductAdvertisingWorkspaceBundle(
    nmId: number,
    input?: {
      startDate?: string;
      endDate?: string;
    },
  ) {
    return wb_clusters_read_flow.getProductAdvertisingWorkspaceBundle(
      this as unknown as WbClustersSnapshotReadContext,
      nmId,
      input,
    );
  }

  async getProductAdvertisingWorkspaceClusterTable(
    nmId: number,
    advertId: number,
    input?: {
      startDate?: string;
      endDate?: string;
      status?: "all" | "active" | "excluded";
      search?: string;
      numericFilters?: string;
      sortKey?: ProductAdvertisingWorkspaceClusterSortKey;
      sortDirection?: ProductAdvertisingWorkspaceClusterSortDirection;
      page?: number;
      pageSize?: number;
    },
  ) {
    return wb_clusters_read_flow.getProductAdvertisingWorkspaceClusterTable(
      this as unknown as WbClustersSnapshotReadContext,
      nmId,
      advertId,
      input,
    );
  }

  async getProductAdvertisingWorkspaceClusterQueries(
    nmId: number,
    advertId: number,
    input: {
      clusterKey?: string;
      clusterName?: string;
      startDate?: string;
      endDate?: string;
      sortKey?: ProductAdvertisingWorkspaceClusterSortKey;
      sortDirection?: ProductAdvertisingWorkspaceClusterSortDirection;
    },
  ) {
    return wb_clusters_read_flow.getProductAdvertisingWorkspaceClusterQueries(
      this as unknown as WbClustersSnapshotReadContext,
      nmId,
      advertId,
      input,
    );
  }

  async getProductAdvertisingSheetBundle(input: {
    nmIds: number[];
    startDate: string;
    endDate: string;
  }) {
    return wb_clusters_read_flow.getProductAdvertisingSheetBundle(
      this as unknown as WbClustersSnapshotReadContext,
      input,
    );
  }

  async materializeProductAdvertisingSheetsForNmIds(
    nmIds: number[],
    reason = "manual-products-tab-materialize",
    exportRequestId?: string,
    startDate?: string,
    endDate?: string,
    priority: ProductSnapshotWarmupPriority = "background",
  ) {
    return wb_clusters_read_flow.materializeProductAdvertisingSheetsForNmIds(
      this as unknown as WbClustersMaterializeContext,
      nmIds,
      reason,
      exportRequestId,
      startDate,
      endDate,
      priority,
    );
  }

  async getProductAdvertisingSheetReadiness(input: {
    nmIds: number[];
    startDate: string;
    endDate: string;
    exportRequestId?: string;
  }): Promise<ProductSnapshotReadinessResponse> {
    return wb_clusters_read_flow.getProductAdvertisingSheetReadiness(this, input);
  }

  async refreshProductAdvertising(
    nmId: number,
  ): Promise<ProductAdvertisingRefreshStartResponse> {
    return wb_clusters_command_flow.refreshProductAdvertising(
      this,
      nmId,
    ) as Promise<ProductAdvertisingRefreshStartResponse>;
  }

  async getProductAdvertisingRefreshStatus(
    nmId: number,
    syncRunId: string,
  ): Promise<ProductAdvertisingRefreshStatusResponse> {
    return wb_clusters_command_flow.getProductAdvertisingRefreshStatus(this, nmId, syncRunId);
  }

  async applyProductClusterAction(
    nmId: number,
    advertId: number,
    action: ProductAdvertisingClusterAction,
    clusterNames: string[],
  ): Promise<ProductAdvertisingClusterActionResponse> {
    return wb_clusters_command_flow.applyProductClusterAction(
      this,
      nmId,
      advertId,
      action,
      clusterNames,
    ) as Promise<ProductAdvertisingClusterActionResponse>;
  }

  async applyProductClusterBids(
    nmId: number,
    advertId: number,
    bids: Array<{
      clusterName: string;
      bid: number;
    }>,
  ): Promise<ProductAdvertisingClusterBidUpdateResponse> {
    return wb_clusters_command_flow.applyProductClusterBids(
      this,
      nmId,
      advertId,
      bids,
    ) as Promise<ProductAdvertisingClusterBidUpdateResponse>;
  }

  async handleClusterBidQueue() {
    return wb_clusters_command_flow.handleClusterBidQueue(
      this as unknown as WbClustersWriteLanesContext,
    );
  }

  async handleClusterActionQueue() {
    return wb_clusters_command_flow.handleClusterActionQueue(
      this as unknown as WbClustersWriteLanesContext,
    );
  }

  async handleClusterBidReconcileQueue() {
    return wb_clusters_command_flow.handleClusterBidReconcileQueue(
      this as unknown as WbClustersWriteLanesContext,
    );
  }

  async handleProductPresetSnapshotQueue() {
    return wb_clusters_command_flow.handleProductPresetSnapshotQueue(
      this as unknown as WbClustersWriteLanesContext,
    );
  }

  async handleScheduledSync() {
    return wb_clusters_sync_flow.handleScheduledSync(this);
  }

  async handleScheduledJamSync() {
    return wb_clusters_sync_flow.handleScheduledJamSync(this);
  }

  async handleJamBackfill() {
    return wb_clusters_sync_flow.handleJamBackfill(this);
  }

  handleCachePrune() {
    this.pruneInMemoryCaches();
  }

  /**
   * Запускается ежедневно в 22:30 МСК (19:30 UTC).
   * Заранее материализует 7-дневный диапазон СЛЕДУЮЩЕГО дня для всех товаров.
   * К полуночи снапшоты уже готовы — пользователь утром видит данные мгновенно,
   * без ожидания пока фоновая материализация пройдёт по всем 166+ товарам.
   */
  async precomputeNextDayPeriod() {
    if (!this.wbClustersRepository.isConfigured()) {
      return;
    }
    try {
      const nmIds = await this.wbClustersRepository.getKnownCatalogNmIds();
      if (nmIds.length === 0) {
        return;
      }
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = this.formatAdvertisingSheetDate(
        this.parseAdvertisingSheetDayValue(this.formatAdvertisingSheetDate(tomorrow))!,
      );
      const weekStart = this.formatAdvertisingSheetDate(
        this.addAdvertisingSheetDays(this.parseAdvertisingSheetDayValue(tomorrowStr)!, -6),
      );
      const nextWeekPeriod = { start: weekStart, end: tomorrowStr };
      this.logger.log(
        `Нночной пре-компьютинг: материализация ${nextWeekPeriod.start}..${nextWeekPeriod.end} для ${nmIds.length} товаров.`,
      );
      this.scheduleProductAdvertisingSheetWarmup(nmIds, "precompute-next-day", nextWeekPeriod, "background");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Ночной пре-компьютинг не удался: ${msg}`);
    }
  }

  /**
   * Called once on module init. Immediately triggers background materialization
   * for all known products across all warm periods (today, week, month).
   * After a PM2 restart the in-memory caches are cold; this ensures that by the
   * time a user opens any product the DB rows are ready and reads are < 100 ms.
   */
  async triggerStartupWarmup() {
    // Startup warmup is intentionally disabled.
    //
    // All user-facing reads now use the SQL-direct fast path (<150 ms per
    // request) and do not require pre-materialized in-memory snapshots.
    // Running bulk materialization on every PM2 restart caused Node.js OOM
    // crashes by filling unbounded in-memory Maps with hundreds of large
    // JSONB objects. The nightly precompute cron keeps DB snapshots fresh.
  }
}
