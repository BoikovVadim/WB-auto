import { Inject, Injectable, Logger } from "@nestjs/common";

import { appEnv } from "../common/env";
import { WbApiClient } from "../wb-sync/wb-api.client";
import { WbRuntimeConfigService } from "../wb-sync/wb-runtime-config.service";
import { WbCabinetPrivateApiClient } from "./wb-cabinet-private-api.client";
import { WbCmpSafariClient } from "./wb-cmp-safari.client";
import { WbSellerPortalPlaywrightClient } from "./wb-seller-portal-playwright.client";
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
import {
  runPrecomputeNextDayPeriod,
  type PrecomputeNextDayContext,
} from "./precompute-monster-gate";
import type {
  WbClustersMaterializeContext,
  WbClustersSnapshotReadContext,
  WbClustersWriteLanesContext,
} from "./wb-clusters.flow-context";
import { WbClustersServiceDataSppStockPrice } from "./wb-clusters.service.data-spp-stock-price";

@Injectable()
export class WbClustersService extends WbClustersServiceDataSppStockPrice {
  readonly logger = new Logger(WbClustersService.name);

  constructor(
    @Inject(WbCabinetPrivateApiClient)
    protected readonly wbCabinetPrivateApiClient: WbCabinetPrivateApiClient,
    @Inject(WbPromotionApiClient)
    protected readonly wbPromotionApiClient: WbPromotionApiClient,
    @Inject(WbApiClient)
    protected readonly wbApiClient: WbApiClient,
    @Inject(WbCmpSafariClient)
    protected readonly wbCmpSafariClient: WbCmpSafariClient,
    @Inject(WbSellerPortalPlaywrightClient)
    protected readonly wbSellerPortalPlaywrightClient: WbSellerPortalPlaywrightClient,
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
    // Create a proper DB sync run so wb_cluster_raw_archive FK is satisfied
    const syncRunId = await this.wbClustersRepository.createSyncRun("manual");
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
      clusterNameSearch?: string;
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
    initiatedBy: "user" | "automation" = "user",
  ): Promise<ProductAdvertisingClusterActionResponse> {
    return wb_clusters_command_flow.applyProductClusterAction(
      this,
      nmId,
      advertId,
      action,
      clusterNames,
      initiatedBy,
    ) as Promise<ProductAdvertisingClusterActionResponse>;
  }

  async applyProductClusterBids(
    nmId: number,
    advertId: number,
    bids: Array<{
      clusterName: string;
      bid: number;
      reason?: string | null;
      position?: number | null;
    }>,
    initiatedBy: "user" | "automation" = "user",
  ): Promise<ProductAdvertisingClusterBidUpdateResponse> {
    return wb_clusters_command_flow.applyProductClusterBids(
      this,
      nmId,
      advertId,
      bids,
      initiatedBy,
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

  async handleScheduledMonthlyFrequencySync() {
    return wb_clusters_sync_flow.handleScheduledMonthlyFrequencySync(this);
  }

  async runMonthlyFrequencySyncNow() {
    return wb_clusters_sync_flow.runMonthlyFrequencySyncNow(this);
  }

  async handleJamBackfill() {
    return wb_clusters_sync_flow.handleJamBackfill(this);
  }

  async handleJamSyncForNmId(nmId: number) {
    if (
      !this.wbClustersRepository.isConfigured() ||
      this.wbRuntimeConfigService.getPromotionTokenSource() === "missing"
    ) {
      return { accepted: false, reason: "not_configured", nmId };
    }

    // Fire-and-forget — runs in background so nginx timeout does not kill the sync.
    const warnings: string[] = [];
    void this.runJamSyncForNmIds([nmId], warnings)
      .then(() => {
        if (warnings.length > 0) {
          this.logger.warn(`JAM sync nm ${nmId} finished with ${warnings.length} warnings: ${warnings.slice(0, 3).join("; ")}`);
        } else {
          this.logger.log(`JAM sync nm ${nmId} finished OK.`);
        }
      })
      .catch((err: Error) => {
        this.logger.error(`JAM sync nm ${nmId} failed: ${err.message}`);
      });

    return { accepted: true, nmId, message: "JAM sync started in background. Check /jam/snapshot/:nmId in ~3 minutes." };
  }

  async getJamBackfillQueueStatus() {
    return this.wbClustersRepository.getJamBackfillQueueStatus();
  }

  async getJamSnapshotDetails(nmId: number) {
    return this.wbClustersRepository.getJamSnapshotDetails(nmId);
  }

  async getRawJamRows(opts: { nmId?: number; dateFrom?: string; dateTo?: string; limit?: number }) {
    return this.wbClustersRepository.getRawJamRows(opts);
  }

  async getRawCampaigns(limit: number) {
    return this.wbClustersRepository.getRawCampaigns(limit);
  }

  async getRawCampaignProducts(opts: { nmId?: number; limit: number }) {
    return this.wbClustersRepository.getRawCampaignProducts(opts);
  }

  async getRawSyncRuns(limit: number) {
    return this.wbClustersRepository.getRawSyncRuns(limit);
  }

  async getRawClusterStats(opts: { nmId?: number; limit: number }) {
    return this.wbClustersRepository.getRawClusterStats(opts);
  }

  async getRawDailyStats(opts: { nmId?: number; limit: number }) {
    return this.wbClustersRepository.getRawDailyStats(opts);
  }

  async getRawMinusPhrases(opts: { nmId?: number; limit: number }) {
    return this.wbClustersRepository.getRawMinusPhrases(opts);
  }

  async getRawQueryFrequencies(limit: number) {
    const now = Date.now();
    const cached = this.rawQueryFrequenciesCache;
    if (cached && cached.limit === limit && now < cached.expiresAtMs) {
      return cached.value;
    }
    const value = await this.wbClustersRepository.getRawQueryFrequencies(limit);
    this.rawQueryFrequenciesCache = {
      limit,
      expiresAtMs: now + this.rawQueryFrequenciesCacheTtlMs,
      value,
    };
    return value;
  }

  async getQueryFrequenciesPaginated(opts: {
    limit: number;
    offset: number;
    search: string | null;
    sortBy: "monthly_frequency" | "query_text" | "subject_name";
    sortDir: "asc" | "desc";
  }) {
    return this.wbClustersRepository.getQueryFrequenciesPaginated(opts);
  }

  async getFrequencyHistoryWeeks() {
    return this.wbClustersRepository.getFrequencyHistoryWeeks();
  }

  async getRawQueryFrequencyHistory(input: { week: string | null; limit: number }) {
    return this.wbClustersRepository.getRawQueryFrequencyHistory(input);
  }

  handleCachePrune() {
    this.pruneInMemoryCaches();
  }

  /**
   * Called after a fresh monthly-frequency import to make all products reflect
   * the new data on the next request, without waiting for cache TTL expiry.
   * Clears snapshot, read-model and jam caches; bumps cacheVersion for every
   * nmId that has an entry so the query-search-index cache also expires.
   */
  clearAllFrequencyCaches() {
    this.productAdvertisingSheetSnapshotCache.clear();
    this.productAdvertisingSheetReadModelCache.clear();
    this.productAdvertisingSheetJamCache.clear();
    this.rawQueryFrequenciesCache = null;
    for (const [nmId, version] of this.productAdvertisingSheetCacheVersion) {
      this.productAdvertisingSheetCacheVersion.set(nmId, version + 1);
    }
    this.logger.log("All frequency-related in-memory caches cleared after import.");
    return { ok: true, clearedAt: new Date().toISOString() };
  }

  /**
   * Запускается ежедневно в 22:30 МСК (сервер в TZ Europe/Moscow).
   * Заранее материализует 7-дневный диапазон СЛЕДУЮЩЕГО дня для всех товаров.
   * К полуночи снапшоты уже готовы — пользователь утром видит данные мгновенно,
   * без ожидания пока фоновая материализация пройдёт по всем 166+ товарам.
   * Прогон серийный (priority "precompute" → concurrency 1): каждая сборка тянет
   * всю «вселенную запросов» товара в память, и параллельные сборки раньше
   * пробивали heap-лимит и роняли бэкенд FATAL OOM.
   */
  async precomputeNextDayPeriod() {
    // Логика (включая гейт по размеру против heap OOM) — в precompute-monster-gate.
    await runPrecomputeNextDayPeriod(
      this as unknown as PrecomputeNextDayContext,
      appEnv.wbPrecomputeMaxQueryRows,
    );
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
