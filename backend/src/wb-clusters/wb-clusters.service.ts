import { Inject, Injectable, Logger } from "@nestjs/common";

import { appEnv } from "../common/env";
import { WbApiClient } from "../wb-sync/wb-api.client";
import { WbSellerAnalyticsApiClient } from "./wb-seller-analytics-api.client";
import { WbAnalyticsCsvClient } from "./wb-analytics-csv.client";
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
import type {
  WbClustersMaterializeContext,
  WbClustersSnapshotReadContext,
  WbClustersWriteLanesContext,
} from "./wb-clusters.flow-context";
import { WbClustersServiceSyncInternals } from "./wb-clusters.service.sync-internals";

@Injectable()
export class WbClustersService extends WbClustersServiceSyncInternals {
  readonly logger = new Logger(WbClustersService.name);
  private readonly analyticsClient = new WbSellerAnalyticsApiClient(
    () => this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken,
  );
  private readonly analyticsCsvClient = new WbAnalyticsCsvClient(
    () => this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken,
  );

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

  async getClusterChangeLog(nmId: number, advertId: number) {
    if (!this.wbClustersRepository.isConfigured()) {
      return { entries: [] };
    }
    await this.wbClustersRepository.ensureSchema();
    const entries = await this.wbClustersRepository.getChangeLogEntries(nmId, advertId);
    return { entries };
  }

  async getAllCostPrices() {
    if (!this.wbClustersRepository.isConfigured()) {
      return { items: [] };
    }
    await this.wbClustersRepository.ensureSchema();
    const items = await this.wbClustersRepository.getAllCurrentCostPrices();
    return { items };
  }

  async getCostPriceHistory(nmId: number) {
    if (!this.wbClustersRepository.isConfigured()) {
      return { nmId, history: [] };
    }
    await this.wbClustersRepository.ensureSchema();
    const history = await this.wbClustersRepository.getCostPriceHistory(nmId);
    return { nmId, history };
  }

  async setProductCostPrice(nmId: number, costValue: number) {
    if (!this.wbClustersRepository.isConfigured()) {
      throw new Error("PostgreSQL не настроен.");
    }
    await this.wbClustersRepository.ensureSchema();
    const current = await this.wbClustersRepository.getAllCurrentCostPrices().then(
      (all) => all.find((c) => c.nmId === nmId) ?? null,
    ).catch(() => null);
    const result = await this.wbClustersRepository.upsertCostPrice(nmId, costValue);
    // Record in history (fire-and-forget; non-critical)
    this.wbClustersRepository.saveSystemChangeLogEntry({
      entityType: "cost_price",
      nmId,
      entityLabel: `Товар #${String(nmId)}`,
      changeType: "set",
      oldValue: current ? String(current.costValue) : null,
      newValue: String(costValue),
    }).catch(() => {/* non-critical */});
    return result;
  }

  async clearProductCostPrice(nmId: number) {
    if (!this.wbClustersRepository.isConfigured()) {
      throw new Error("PostgreSQL не настроен.");
    }
    const current = await this.wbClustersRepository.getAllCurrentCostPrices().then(
      (all) => all.find((c) => c.nmId === nmId) ?? null,
    ).catch(() => null);
    await this.wbClustersRepository.deleteTodayCostPrice(nmId);
    // Record in history (fire-and-forget; non-critical)
    this.wbClustersRepository.saveSystemChangeLogEntry({
      entityType: "cost_price",
      nmId,
      entityLabel: `Товар #${String(nmId)}`,
      changeType: "clear",
      oldValue: current ? String(current.costValue) : null,
      newValue: "—",
    }).catch(() => {/* non-critical */});
  }

  /**
   * Returns a matrix of all products × all dates for the retrospective view.
   * Response shape: { dates: string[]; products: { nmId: number; values: (number | null)[] }[] }
   * dates are sorted newest → oldest; values are parallel to dates.
   */
  async getCostPriceMatrix() {
    if (!this.wbClustersRepository.isConfigured()) {
      return { dates: [], products: [] };
    }
    await this.wbClustersRepository.ensureSchema();
    const rows = await this.wbClustersRepository.getAllCostPricesMatrix();

    // Collect all unique dates, newest first
    const dateSet = new Set<string>();
    for (const row of rows) dateSet.add(row.effectiveDate);
    const dates = [...dateSet].sort((a, b) => b.localeCompare(a));

    // Build per-product value arrays
    const productMap = new Map<number, Map<string, number>>();
    for (const row of rows) {
      let dateMap = productMap.get(row.nmId);
      if (!dateMap) { dateMap = new Map(); productMap.set(row.nmId, dateMap); }
      dateMap.set(row.effectiveDate, row.costValue);
    }

    const products = [...productMap.entries()].map(([nmId, dateMap]) => ({
      nmId,
      values: dates.map((d) => dateMap.get(d) ?? null),
    }));

    return { dates, products };
  }

  async getUnifiedChangeLog(limit = 500) {
    if (!this.wbClustersRepository.isConfigured()) {
      return { entries: [] };
    }
    await this.wbClustersRepository.ensureSchema();
    const entries = await this.wbClustersRepository.getUnifiedChangeLog(limit);
    return { entries };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Orders sync (WB Statistics API)
  // ─────────────────────────────────────────────────────────────────────────

  /** Returns per-product per-day order rows from wb_product_daily_orders. Simple SELECT. */
  async getOrdersMatrix() {
    if (!this.wbClustersRepository.isConfigured()) return [];
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getOrdersMatrix();
  }

  /** Returns all JAM daily rows from wb_product_jam_daily for the retrospective matrix. */
  async getJamDailyMatrix() {
    if (!this.wbClustersRepository.isConfigured()) return [];
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getJamDailyMatrix();
  }

  /** Returns latest JAM position per product (most recent jam_date). */
  async getLatestJamPositions() {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const items = await this.wbClustersRepository.getLatestJamPositions();
    return { items };
  }

  /** Returns JAM metrics summed for a product over a date range. Used by advertising cluster view. */
  async getJamDailySummaryForProduct(nmId: number, fromDate: string, toDate: string) {
    if (!this.wbClustersRepository.isConfigured()) return null;
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getJamDailySummaryForProduct(nmId, fromDate, toDate);
  }

  /**
   * Materializes JAM daily rows for the current calendar month from phrase-level snapshots.
   * Run once to backfill; safe to re-run (ON CONFLICT DO UPDATE).
   * Returns the total number of product-day rows written.
   */
  async materializeJamDailyForMonth(): Promise<number> {
    if (!this.wbClustersRepository.isConfigured()) return 0;
    await this.wbClustersRepository.ensureSchema();

    // Use the SAME calendar basis as the JAM snapshot writers (server-local date
    // via formatAdvertisingSheetDate). Mixing a Moscow-shifted clock with UTC day
    // construction here would query the wrong start_date around day boundaries and
    // silently materialize 0 rows.
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const todayDay = now.getDate();

    let totalRows = 0;
    for (let day = 1; day <= todayDay; day++) {
      const d = new Date(year, month, day);
      const dateStr = this.formatAdvertisingSheetDate(d);
      const count = await this.wbClustersRepository.materializeJamDailyForDate(dateStr);
      totalRows += count;
    }
    this.logger.log(`JAM daily backfill for ${String(year)}-${String(month + 1).padStart(2, "0")}: ${totalRows} product-day rows`);
    return totalRows;
  }

  /**
   * Materializes JAM daily rows for the last N days from phrase-level snapshots.
   * Called automatically after each nightly JAM sync.
   * Safe to call multiple times (ON CONFLICT DO UPDATE).
   */
  async materializeJamDaily(daysBack = 1): Promise<void> {
    if (!this.wbClustersRepository.isConfigured()) return;
    await this.wbClustersRepository.ensureSchema();

    const total: number[] = [];
    for (let i = daysBack; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      // Match the JAM snapshot writers' server-local date format, not UTC.
      const dateStr = this.formatAdvertisingSheetDate(d);
      const count = await this.wbClustersRepository.materializeJamDailyForDate(dateStr);
      total.push(count);
    }
    this.logger.log(
      `JAM daily materialized: ${total.reduce((a, b) => a + b, 0)} product-day rows for last ${daysBack + 1} days`,
    );
  }

  /** Returns today's order counts from wb_product_daily_orders. */
  async getTodayOrderCounts() {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const items = await this.wbClustersRepository.getTodayOrderCounts();
    return { items };
  }

  // ─── Orders sync ────────────────────────────────────────────────────────────
  //
  // Architecture (Google-Sheets style):
  //   1. Download data from Analytics API → wb_product_daily_orders(nm_id, order_date, orders_count)
  //   2. Frontend does: SELECT nm_id, order_date, orders_count FROM wb_product_daily_orders
  //      (equivalent to VLOOKUP: key=nm_id+date, value=orders_count)
  //
  // Why Analytics API (not Statistics API):
  //   Statistics API /api/v1/supplier/orders: excludes unconfirmed-payment orders → wrong numbers
  //   Analytics API /api/v3/sales-funnel/products/history: matches WB dashboard "Заказали товаров"
  //
  // WB API constraint: nmIds required, max 20 per request → batched internally in the client.

  private getMoscowDateStr(offsetDays = 0): string {
    const d = new Date(Date.now() + 3 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }

  private async guardOrdersSync(): Promise<boolean> {
    if (!appEnv.wbOrdersSyncEnabled) return false;
    if (!this.wbClustersRepository.isConfigured()) return false;
    await this.wbClustersRepository.ensureSchema();
    const token = this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken;
    if (!token) { this.logger.warn("Orders sync: WB_API_TOKEN not set, skip."); return false; }
    return true;
  }

  /**
   * Downloads orders via Analytics CSV report (DETAIL_HISTORY_REPORT).
   * One POST → poll → download ZIP → parse → upsert. No nmId batching.
   * Result: wb_product_daily_orders(nm_id, order_date, orders_count) — simple SELECT on frontend.
   * Matches WB dashboard "Заказали товаров" metric.
   */
  async syncOrdersFromAnalytics(daysBack = 6): Promise<void> {
    if (!await this.guardOrdersSync()) return;

    const endDate   = this.getMoscowDateStr(0);
    const startDate = this.getMoscowDateStr(-daysBack);
    this.logger.log(`Orders CSV sync: ${startDate} → ${endDate}`);

    let rows: Awaited<ReturnType<WbAnalyticsCsvClient["fetchOrdersReport"]>>;
    try {
      rows = await this.analyticsCsvClient.fetchOrdersReport(startDate, endDate);
    } catch (err) {
      this.logger.warn(`Orders CSV sync error: ${(err as Error).message}`);
      return;
    }

    if (rows.length === 0) { this.logger.log("Orders CSV sync: empty report."); return; }

    // Sanity log: totals by date
    const byDate = new Map<string, number>();
    for (const r of rows) byDate.set(r.orderDate, (byDate.get(r.orderDate) ?? 0) + r.ordersCount);
    const top = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
    this.logger.log(`Orders CSV by date: ${top.map(([d, n]) => `${d}:${n}`).join(", ")}`);

    // Upsert into wb_product_daily_orders
    const upsertRows = rows.map((r) => ({
      nmId: r.nmId,
      orderDate: r.orderDate,
      ordersCount: r.ordersCount,
      cancelledCount: r.cancelCount,
      ordersSum: r.ordersSum,
    }));

    await this.wbClustersRepository.clearOrdersForDateRange(startDate);
    await this.wbClustersRepository.upsertDailyOrders(upsertRows);
    this.logger.log(`Orders CSV sync done: ${upsertRows.length} product-day rows`);
  }


  /** Nightly snapshot: copies each product's latest cost price into today's row (idempotent). */
  async snapshotCostPricesToday(): Promise<void> {
    if (!this.wbClustersRepository.isConfigured()) return;
    await this.wbClustersRepository.ensureSchema();
    const inserted = await this.wbClustersRepository.snapshotLatestCostPricesToToday();
    this.logger.log(`Cost price daily snapshot: ${inserted} rows inserted.`);
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
