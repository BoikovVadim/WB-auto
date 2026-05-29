import { Inject, Injectable, Logger } from "@nestjs/common";

import { appEnv } from "../common/env";
import { WbApiClient } from "../wb-sync/wb-api.client";
import { WbSellerAnalyticsApiClient } from "./wb-seller-analytics-api.client";
import { WbAnalyticsCsvClient } from "./wb-analytics-csv.client";
import { WbStatisticsApiClient } from "./wb-statistics-api.client";
import { WbPricesApiClient } from "./wb-prices-api.client";
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
  private readonly statisticsApiClient = new WbStatisticsApiClient(
    () => this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken,
  );
  private readonly pricesApiClient = new WbPricesApiClient(
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

  /**
   * Compact-format orders matrix: { dates, products: [{ nmId, vals: (number | null)[] }] }.
   * `vals[i]` is orders count on `dates[i]`; `null` means «no row in DB». This preserves
   * the original UX where 0 (WB reported zero orders) is shown as «0» and absence as «—».
   * Replaces the row-per-(nmId,date) format and shrinks the payload ~10-15× while keeping
   * the visual semantics identical to the legacy /orders-matrix endpoint.
   */
  async getOrdersMatrixCompact(): Promise<{
    dates: string[];
    products: { nmId: number; vals: (number | null)[] }[];
  }> {
    if (!this.wbClustersRepository.isConfigured()) return { dates: [], products: [] };
    await this.wbClustersRepository.ensureSchema();
    const rows = await this.wbClustersRepository.getOrdersMatrix();
    if (rows.length === 0) return { dates: [], products: [] };

    const datesSet = new Set<string>();
    for (const r of rows) datesSet.add(r.orderDate);
    const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1));
    const dateIdx = new Map<string, number>();
    for (let i = 0; i < dates.length; i++) dateIdx.set(dates[i]!, i);

    const productMap = new Map<number, (number | null)[]>();
    for (const r of rows) {
      const idx = dateIdx.get(r.orderDate);
      if (idx === undefined) continue;
      let vals = productMap.get(r.nmId);
      if (!vals) {
        vals = new Array<number | null>(dates.length).fill(null);
        productMap.set(r.nmId, vals);
      }
      vals[idx] = r.ordersCount;
    }
    const products = Array.from(productMap.entries()).map(([nmId, vals]) => ({ nmId, vals }));
    return { dates, products };
  }

  /** Returns today's order counts from wb_product_daily_orders. */
  async getTodayOrderCounts() {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const items = await this.wbClustersRepository.getTodayOrderCounts();
    return { items };
  }

  /** Returns today's orders sum per product (CSV-derived, совпадает с WB-дашбордом). */
  async getTodayOrdersSum() {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const items = await this.wbClustersRepository.getTodayOrdersSum();
    return { items };
  }

  /** Returns orders-sum matrix (compact: dates[] + products[]{nmId, vals[]}) для ретроспективы. */
  async getOrdersSumMatrixCompact(): Promise<{
    dates: string[];
    products: { nmId: number; vals: (number | null)[] }[];
  }> {
    if (!this.wbClustersRepository.isConfigured()) return { dates: [], products: [] };
    await this.wbClustersRepository.ensureSchema();
    const rows = await this.wbClustersRepository.getOrdersSumMatrix();
    if (rows.length === 0) return { dates: [], products: [] };

    const datesSet = new Set<string>();
    for (const r of rows) datesSet.add(r.orderDate);
    const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1));
    const dateIdx = new Map<string, number>();
    for (let i = 0; i < dates.length; i++) dateIdx.set(dates[i]!, i);

    const productMap = new Map<number, (number | null)[]>();
    for (const r of rows) {
      const idx = dateIdx.get(r.orderDate);
      if (idx === undefined) continue;
      let vals = productMap.get(r.nmId);
      if (!vals) {
        vals = new Array<number | null>(dates.length).fill(null);
        productMap.set(r.nmId, vals);
      }
      vals[idx] = r.ordersSum;
    }
    const products = Array.from(productMap.entries()).map(([nmId, vals]) => ({ nmId, vals }));
    return { dates, products };
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
      buyoutsCount: r.buyoutsCount,
      buyoutsSum: r.buyoutsSum,
    }));

    await this.wbClustersRepository.clearOrdersForDateRange(startDate);
    await this.wbClustersRepository.upsertDailyOrders(upsertRows);
    this.logger.log(`Orders CSV sync done: ${upsertRows.length} product-day rows`);
  }

  /**
   * Reconcile `wb_product_daily_orders` against WB Analytics CSV (DETAIL_HISTORY_REPORT)
   * for the last `daysBack` days. WB revises a day's orders/buyouts for ~2 weeks after
   * the order date, поэтому ночью достаточно тянуть КОРОТКИЙ отчёт (по умолчанию 30 дней),
   * а не годовой: он генерится у WB за секунды, поллинг успевает за 1–2 итерации и почти
   * не задевает rate-limit списка отчётов (именно долгая генерация годового отчёта держала
   * нас в поллинге минутами и ловила 429). Старшие 30 дней дни уже финальны и не меняются —
   * перетягивать их каждую ночь незачем.
   *
   * `daysBack = 364` — разовый/редкий полный бэкфилл (первая установка, заполнение
   * пропусков); вызывается вручную через эндпоинт. Идемпотентно и diff-aware.
   */
  async syncOrdersFromAnalyticsFullYear(daysBack = 364): Promise<{ status: "ok" | "skipped"; rows: number }> {
    if (!await this.guardOrdersSync()) return { status: "skipped", rows: 0 };

    const windowDays = Math.max(1, Math.floor(daysBack));
    const endDate   = this.getMoscowDateStr(0);
    const startDate = this.getMoscowDateStr(-windowDays);
    this.logger.log(`Orders CSV reconcile (${windowDays} d): ${startDate} → ${endDate}`);

    // Короткий отчёт генерится быстро, но оставляем запас по времени и ретраи —
    // на случай дневного троттлинга списка отчётов 429.
    const WAIT_MS = 15 * 60_000;
    const MAX_ATTEMPTS = 3;
    let rows: Awaited<ReturnType<WbAnalyticsCsvClient["fetchOrdersReport"]>> | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        rows = await this.analyticsCsvClient.fetchOrdersReport(startDate, endDate, WAIT_MS);
        break;
      } catch (err) {
        this.logger.warn(
          `Orders CSV reconcile (${windowDays} d) attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(err as Error).message}`,
        );
        if (attempt === MAX_ATTEMPTS) return { status: "skipped", rows: 0 };
        await new Promise<void>((r) => { setTimeout(r, 60_000); });
      }
    }
    if (!rows) return { status: "skipped", rows: 0 };

    if (rows.length === 0) {
      this.logger.log(`Orders CSV reconcile (${windowDays} d): empty report.`);
      return { status: "ok", rows: 0 };
    }

    const upsertRows = rows.map((r) => ({
      nmId: r.nmId,
      orderDate: r.orderDate,
      ordersCount: r.ordersCount,
      cancelledCount: r.cancelCount,
      ordersSum: r.ordersSum,
      buyoutsCount: r.buyoutsCount,
      buyoutsSum: r.buyoutsSum,
    }));

    // Сверка идемпотентна и diff-aware: НЕ чистим диапазон (иначе пропуски в
    // выгрузке временно обнулили бы данные), а upsert сам трогает только те
    // строки, где значение реально изменилось.
    const { changedRows, changedDates } = await this.wbClustersRepository.upsertDailyOrders(upsertRows);
    if (changedRows === 0) {
      this.logger.log(`Orders CSV reconcile (${windowDays} d): ${upsertRows.length} rows checked, nothing changed.`);
    } else {
      this.logger.log(
        `Orders CSV reconcile (${windowDays} d): ${upsertRows.length} rows checked, ` +
          `${changedRows} updated across ${changedDates.length} day(s): ${changedDates.join(", ")}`,
      );
    }
    return { status: "ok", rows: changedRows };
  }

  // ─── Today's live orders via Sales Funnel (Воронка продаж) ───────────────────
  //
  // Источник: POST /api/analytics/v3/sales-funnel/products (сводка за период).
  // orderCount/orderSum совпадают с кабинетом WB «Заказали товаров (на сумму)» —
  // в отличие от Statistics API, Воронка ВКЛЮЧАЕТ заказы с неподтверждённой
  // оплатой. Statistics их выкидывал → систематический недосчёт (замерено вживую
  // 29.05: 883 против 1001 заказа, −12% count / −11% сумма). Именно эта дыра и
  // была видна как «у нас на ~100 меньше».
  //
  // Почему /products, а не /history: /history требует список nmId и режется по
  // 20 на запрос (весь каталог = ~23 батча × 25с ≈ 10 мин). /products НЕ требует
  // nmId и пагинируется по 1000 — все активные товары за сегодня приходят за
  // ОДИН запрос (≈ секунды). Эндпоинт отдаёт и orderCount/orderSum, и cancelCount.
  //
  // Что пишем для сегодняшней даты:
  //   - orders_count    = orderCount  (как в кабинете);
  //   - orders_sum      = orderSum    («Заказали на сумму»);
  //   - cancelled_count = cancelCount (Воронка отдаёт отмены отдельно).
  // Buyouts не трогаем — их закрывает ночной CSV.
  //
  // NB: данные Воронки у WB обновляются примерно раз в час, поэтому чаще, чем
  // раз в ~15 мин (см. wbOrdersSyncCron), дёргать смысла нет — число всё равно
  // меняется не чаще часа. Запрос дешёвый (1 шт.), в лимит 3 req/min укладывается
  // с запасом.

  async syncOrdersTodayFromSalesFunnel(): Promise<void> {
    if (!await this.guardOrdersSync()) return;

    const todayStr = this.getMoscowDateStr(0);
    let products: Awaited<ReturnType<WbSellerAnalyticsApiClient["fetchProductsSummary"]>>;
    try {
      products = await this.analyticsClient.fetchProductsSummary(todayStr, todayStr);
    } catch (err) {
      // Запрос не удался — НЕ обнуляем сегодня, оставляем прошлые значения.
      this.logger.warn(`Orders Sales Funnel sync error: ${(err as Error).message}`);
      return;
    }

    const upserts: { nmId: number; ordersCount: number; cancelledCount: number; ordersSum: number }[] = [];
    let totalOrders = 0;
    let totalSum = 0;
    for (const p of products) {
      if (p.orderCount === 0 && p.orderSum === 0) continue;
      totalOrders += p.orderCount;
      totalSum += p.orderSum;
      upserts.push({
        nmId: p.nmId,
        ordersCount: p.orderCount,
        cancelledCount: p.cancelCount,
        ordersSum: Math.round(p.orderSum * 100) / 100,
      });
    }

    // Сначала обнуляем сегодняшние строки (товары, чьи заказы за день обнулились,
    // корректно падают на 0), затем пишем живые агрегаты из Воронки.
    await this.wbClustersRepository.resetTodayLiveOrdersFields();
    if (upserts.length > 0) {
      await this.wbClustersRepository.upsertOrdersTodayLive(upserts);
    }
    this.logger.log(
      `Orders Sales Funnel sync (${todayStr}): ${products.length} активных товаров → ` +
        `${upserts.length} с заказами, ${totalOrders} заказов, сумма ${totalSum.toFixed(2)}`,
    );
  }

  // ─── Buyout % read-model ────────────────────────────────────────────────────

  /** Returns today's buyout counts (with matching orders counts) per product. */
  async getTodayBuyoutCounts() {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const items = await this.wbClustersRepository.getTodayBuyoutCounts();
    return { items };
  }

  /**
   * Rolling-window buyout counts (default: 365 days). Frontend renders
   * % выкупа = buyouts / orders × 100 for this aggregate.
   *
   * Reads the precomputed daily snapshot (instant). Falls back to on-the-fly
   * aggregation only if the snapshot table is empty (cold start).
   */
  async getRollingBuyoutCounts(days = 365) {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    // Считаем ЖИВОЕ скользящее окно, заканчивающееся СЕГОДНЯ. Раньше тут
    // короткозамыкался getLatestBuyoutSnapshot() (последний снапшот = вчера),
    // из-за чего колонка «сегодня» в ретроспективе байт-в-байт повторяла колонку
    // «вчера» — это и была «нет разницы в Итого». Окно до сегодня отличается от
    // вчерашнего снапшота (включает сегодняшние заказы), так что дубля больше нет.
    const items = await this.wbClustersRepository.getRollingBuyoutCounts(days);
    return { items };
  }

  /**
   * Snapshot matrix for the «% выкупа» retrospective: dates + per-product %
   * per day. Read straight from wb_product_buyout_daily_snapshot — instant.
   */
  async getBuyoutSnapshotMatrix() {
    if (!this.wbClustersRepository.isConfigured()) return { dates: [], products: [] };
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getBuyoutSnapshotMatrix();
  }

  // ─── Выручка (производная: Сумма заказов × % выкупа) ──────────────────────────
  //
  // Потенциальная выручка за день = сумма заказов × доля выкупа. Метрика
  // полностью считается ЗДЕСЬ, на сервере (фронт только рисует) — из этих цифр
  // дальше вырастут более сложные формулы (минус возвраты, комиссия, логистика,
  // хранение), и им место в одном источнике истины под тестами.
  //
  // «Сегодня»: ordersSum(today) × rolling-выкуп(365). «История»: ordersSum(дата) ×
  // %выкупа(дата) из снапшот-матрицы — ровно тот же выкуп, что показывает
  // ретроспектива «% выкупа» за этот день. «Нет данных» → товар не попадает в
  // выдачу, если нет суммы заказов ИЛИ нет выкупа (0 выкупов = WB ещё не отдал).

  /** Сегодняшняя потенциальная выручка по товарам: ordersSum × rolling-выкуп. */
  async getTodayRevenue(): Promise<{ items: { nmId: number; revenue: number }[] }> {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const [ordersSum, buyout] = await Promise.all([
      this.wbClustersRepository.getTodayOrdersSum(),
      this.wbClustersRepository.getRollingBuyoutCounts(365),
    ]);
    const buyoutByNmId = new Map<number, { ordersCount: number; buyoutsCount: number }>();
    for (const b of buyout) buyoutByNmId.set(b.nmId, b);
    const items: { nmId: number; revenue: number }[] = [];
    for (const o of ordersSum) {
      if (o.ordersSum <= 0) continue;
      const b = buyoutByNmId.get(o.nmId);
      if (!b || b.ordersCount === 0 || b.buyoutsCount === 0) continue;
      const buyoutFraction = b.buyoutsCount / b.ordersCount;
      items.push({ nmId: o.nmId, revenue: o.ordersSum * buyoutFraction });
    }
    return { items };
  }

  /** Матрица "товары × даты" выручки (compact): ordersSum(дата) × %выкупа(дата) / 100. */
  async getRevenueMatrixCompact(): Promise<{
    dates: string[];
    products: { nmId: number; vals: (number | null)[] }[];
  }> {
    if (!this.wbClustersRepository.isConfigured()) return { dates: [], products: [] };
    await this.wbClustersRepository.ensureSchema();
    const [ordersRows, buyoutMatrix] = await Promise.all([
      this.wbClustersRepository.getOrdersSumMatrix(),
      this.wbClustersRepository.getBuyoutSnapshotMatrix(),
    ]);
    if (ordersRows.length === 0) return { dates: [], products: [] };

    // %выкупа по (nmId, дата) из снапшот-матрицы — для быстрого джойна с заказами.
    const buyoutDateIdx = new Map<string, number>();
    buyoutMatrix.dates.forEach((d, i) => buyoutDateIdx.set(d, i));
    const buyoutByNmId = new Map<number, (number | null)[]>();
    for (const p of buyoutMatrix.products) buyoutByNmId.set(p.nmId, p.percents);

    // Колонки = дни, за которые есть И сумма заказов, И снапшот %выкупа: выручка =
    // ordersSum × %выкупа, без %выкупа её не посчитать. Заказы бэкфилятся за год назад,
    // а снапшоты %выкупа копятся вперёд от момента запуска — поэтому без фильтра по
    // выкупу матрица показывала год пустых колонок «—». Оставляем только дни с реальными
    // данными; история копится сама по мере накопления снапшотов выкупа.
    const datesSet = new Set<string>();
    for (const r of ordersRows) {
      if (buyoutDateIdx.has(r.orderDate)) datesSet.add(r.orderDate);
    }
    const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1));
    const dateIdx = new Map<string, number>();
    for (let i = 0; i < dates.length; i++) dateIdx.set(dates[i]!, i);

    const productMap = new Map<number, (number | null)[]>();
    for (const r of ordersRows) {
      const colIdx = dateIdx.get(r.orderDate);
      if (colIdx === undefined) continue;
      if (r.ordersSum <= 0) continue;
      const percents = buyoutByNmId.get(r.nmId);
      const bIdx = buyoutDateIdx.get(r.orderDate);
      const percent = percents && bIdx !== undefined ? percents[bIdx] : null;
      if (percent == null) continue; // нет выкупа за этот день → «нет данных»
      let vals = productMap.get(r.nmId);
      if (!vals) {
        vals = new Array<number | null>(dates.length).fill(null);
        productMap.set(r.nmId, vals);
      }
      vals[colIdx] = (r.ordersSum * percent) / 100;
    }
    const products = Array.from(productMap.entries()).map(([nmId, vals]) => ({ nmId, vals }));
    return { dates, products };
  }

  // ─── С/с продаж (производная: Заказы × % выкупа × себестоимость) ──────────────
  //
  // Себестоимость выкупленных заказов — зеркало «Выручки», только себестоимость
  // вместо суммы заказов. Метрика считается ЗДЕСЬ, на сервере (фронт рисует).
  // «Сегодня»: заказы(today) × rolling-выкуп(365) × текущая себестоимость.
  // «История»: cost_sum за день из снапшот-таблицы (тот же % выкупа, что у Выручки).
  // Ретроспектива стартует с момента запуска и копится вперёд — backfill НЕ делаем
  // (себестоимость по прошлым дням недостоверна). «Нет данных» → товар не в выдаче,
  // если нет заказов ИЛИ нет выкупа (0 выкупов = лаг WB) ИЛИ нет себестоимости.

  /** Сегодняшняя «С/с продаж» по товарам: заказы(today) × rolling-выкуп × себестоимость. */
  async getTodayCostSum(): Promise<{ items: { nmId: number; costSum: number }[] }> {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const [todayCounts, rolling, costs] = await Promise.all([
      this.wbClustersRepository.getTodayBuyoutCounts(),
      this.wbClustersRepository.getRollingBuyoutCounts(365),
      this.wbClustersRepository.getAllCurrentCostPrices(),
    ]);
    const rollingByNmId = new Map<number, { ordersCount: number; buyoutsCount: number }>();
    for (const b of rolling) rollingByNmId.set(b.nmId, b);
    const costByNmId = new Map<number, number>();
    for (const c of costs) costByNmId.set(c.nmId, c.costValue);
    const items: { nmId: number; costSum: number }[] = [];
    for (const t of todayCounts) {
      if (t.ordersCount <= 0) continue;
      const b = rollingByNmId.get(t.nmId);
      if (!b || b.ordersCount === 0 || b.buyoutsCount === 0) continue;
      const cost = costByNmId.get(t.nmId);
      if (cost == null || cost <= 0) continue;
      const buyoutFraction = b.buyoutsCount / b.ordersCount;
      items.push({ nmId: t.nmId, costSum: t.ordersCount * buyoutFraction * cost });
    }
    return { items };
  }

  /** Матрица "товары × даты" «С/с продаж» (compact) — читается из снапшот-таблицы. */
  async getCostSumMatrixCompact(): Promise<{
    dates: string[];
    products: { nmId: number; vals: (number | null)[] }[];
  }> {
    if (!this.wbClustersRepository.isConfigured()) return { dates: [], products: [] };
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getCostSumSnapshotMatrix();
  }

  // ─── Расходы на рекламу (агрегат wb_cluster_daily_stats по товару) ────────────
  //
  // «Общий расход на товар» = SUM(spend) по всем кампаниям/кластерам за день.
  // Дневная статистика синкается для всех кампаний (cpm + cpc), backfill истории
  // уже есть → считаем на лету, отдельная таблица/крон не нужны (как «Выручка»).

  /** Сегодняшний (МСК) расход на рекламу по товарам. */
  async getTodayAdSpend(): Promise<{ items: { nmId: number; spend: number }[] }> {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const today = this.getMoscowDateStr(0);
    const items = await this.wbClustersRepository.getAdSpendForDate(today);
    return { items };
  }

  /** Compact-матрица «товары × даты» расхода на рекламу. */
  async getAdSpendMatrixCompact(): Promise<{
    dates: string[];
    products: { nmId: number; vals: (number | null)[] }[];
  }> {
    if (!this.wbClustersRepository.isConfigured()) return { dates: [], products: [] };
    await this.wbClustersRepository.ensureSchema();
    const rows = await this.wbClustersRepository.getAdSpendMatrix();
    if (rows.length === 0) return { dates: [], products: [] };

    const datesSet = new Set<string>();
    for (const r of rows) datesSet.add(r.spendDate);
    const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1));
    const dateIdx = new Map<string, number>();
    for (let i = 0; i < dates.length; i++) dateIdx.set(dates[i]!, i);

    const productMap = new Map<number, (number | null)[]>();
    for (const r of rows) {
      const idx = dateIdx.get(r.spendDate);
      if (idx === undefined) continue;
      let vals = productMap.get(r.nmId);
      if (!vals) {
        vals = new Array<number | null>(dates.length).fill(null);
        productMap.set(r.nmId, vals);
      }
      vals[idx] = r.spend;
    }
    const products = Array.from(productMap.entries()).map(([nmId, vals]) => ({ nmId, vals }));
    return { dates, products };
  }

  /**
   * Фиксирует «С/с продаж» за вчера (Москва) в снапшот-таблицу. Запускается cron-ом
   * раз в сутки ПОСЛЕ снапшота % выкупа (тот же %, что и у «Выручки»). Строка за
   * закрытый день неизменна; история копится вперёд от момента запуска.
   */
  async snapshotCostSumForYesterday(): Promise<void> {
    if (!this.wbClustersRepository.isConfigured()) return;
    await this.wbClustersRepository.ensureSchema();
    const result = await this.wbClustersRepository.materializeCostSumSnapshotForYesterday();
    this.logger.log(
      `Cost-sum snapshot materialized for ${result.snapshotDate}: ${result.rowsWritten} rows`,
    );
  }

  /**
   * Fixes the «% выкупа» snapshot for yesterday (Moscow) based on the last `days`
   * days of wb_product_daily_orders. Runs once a day from cron at 03:40 МСК — after
   * the full-year orders backfill (03:30) and well after WB has finalized yesterday's
   * numbers (~02:00). The resulting row is the closed-day historical record.
   */
  async snapshotBuyoutsRolling(days = 365): Promise<void> {
    if (!this.wbClustersRepository.isConfigured()) return;
    await this.wbClustersRepository.ensureSchema();
    const result = await this.wbClustersRepository.materializeBuyoutSnapshotForYesterday(days);
    this.logger.log(
      `Buyout-percent snapshot materialized for ${result.snapshotDate}: ${result.rowsWritten} rows (window ${days} d)`,
    );
  }

  // ─── СПП (средняя скидка постоянного покупателя по заказам) ────────────────────
  //
  // spp приходит на каждый заказ ТОЛЬКО из Statistics API (/api/v1/supplier/orders).
  // «СПП за день» = простое среднее AVG(spp) по всем заказам товара за московский день.
  // «Сегодня» освежает 6-часовой cron, закрытый день добивается ночью, история — разовым
  // backfill за неделю. Источник тяжёлый (лимит ~1 запрос/мин) → НЕ считаем на лету на
  // каждый рендер: фронт читает уже сохранённые строки wb_product_spp_daily.

  /** Группирует строки заказов по nmId и считает простое среднее spp за день. */
  private aggregateSppByNm(
    rows: Awaited<ReturnType<WbStatisticsApiClient["fetchOrdersForDay"]>>,
  ): { nmId: number; sppAvg: number; ordersCount: number }[] {
    const acc = new Map<number, { sum: number; count: number }>();
    for (const r of rows) {
      if (typeof r.nmId !== "number" || typeof r.spp !== "number") continue;
      const e = acc.get(r.nmId);
      if (e) { e.sum += r.spp; e.count += 1; }
      else acc.set(r.nmId, { sum: r.spp, count: 1 });
    }
    const out: { nmId: number; sppAvg: number; ordersCount: number }[] = [];
    for (const [nmId, e] of acc) {
      if (e.count === 0) continue;
      out.push({ nmId, sppAvg: e.sum / e.count, ordersCount: e.count });
    }
    return out;
  }

  /** Тянет заказы за конкретный московский день (flag=1), считает среднюю СПП и апсертит. */
  async syncSppForDay(moscowDateStr: string): Promise<void> {
    if (!await this.guardOrdersSync()) return;
    let rows: Awaited<ReturnType<WbStatisticsApiClient["fetchOrdersForDay"]>>;
    try {
      rows = await this.statisticsApiClient.fetchOrdersForDay(moscowDateStr);
    } catch (err) {
      this.logger.warn(`SPP sync ${moscowDateStr}: ошибка загрузки заказов: ${(err as Error).message}`);
      return;
    }
    const aggregates = this.aggregateSppByNm(rows);
    const written = await this.wbClustersRepository.upsertSppDaily(moscowDateStr, aggregates);
    this.logger.log(`SPP sync ${moscowDateStr}: ${written} товаров (из ${rows.length} заказов)`);
  }

  /** Освежает СПП за сегодня (Москва). Cron каждые 6 часов. */
  async syncSppToday(): Promise<void> {
    await this.syncSppForDay(this.getMoscowDateStr(0));
  }

  /** Добивает СПП за вчера (Москва) после закрытия дня. Ночной cron. */
  async syncSppYesterday(): Promise<void> {
    await this.syncSppForDay(this.getMoscowDateStr(-1));
  }

  /**
   * Разовый backfill СПП: сегодня + последние `days` закрытых дней. Каждый день —
   * отдельный запрос к Statistics API (троттл клиента ~1 req/min), поэтому 7 дней
   * ≈ 7-8 минут. Идемпотентно (ON CONFLICT перезаписывает день). Запускается в фоне
   * из контроллера разово после деплоя.
   */
  async backfillSppLastDays(days = 7): Promise<{ days: number }> {
    if (!await this.guardOrdersSync()) return { days: 0 };
    let done = 0;
    for (let offset = 0; offset <= days; offset++) {
      await this.syncSppForDay(this.getMoscowDateStr(-offset));
      done += 1;
    }
    this.logger.log(`SPP backfill завершён: ${done} дней (сегодня + ${days})`);
    return { days: done };
  }

  /** Сегодняшняя средняя СПП по товарам (читается из wb_product_spp_daily). */
  async getTodaySpp(): Promise<{ items: { nmId: number; spp: number }[] }> {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    return { items: await this.wbClustersRepository.getSppToday() };
  }

  /** Матрица "товары × даты" СПП (compact) — закрытые дни из wb_product_spp_daily. */
  async getSppMatrixCompact(): Promise<{
    dates: string[];
    products: { nmId: number; vals: (number | null)[] }[];
  }> {
    if (!this.wbClustersRepository.isConfigured()) return { dates: [], products: [] };
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getSppDailyMatrix();
  }

  /**
   * Rolling-window orders/cancels/returns aggregate per product (default 365 days).
   * Frontend computes % выкупа = (orders − cancels − returns) / orders × 100.
   */
  async getRollingBuyoutBreakdown(days = 365) {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const items = await this.wbClustersRepository.getRollingBuyoutBreakdown(days);
    return { items };
  }

  /**
   * Downloads sales (включая возвраты) from WB Statistics API since `daysBack` days ago,
   * filters returns (saleID starts with "R"), aggregates per nmId × date, and upserts
   * into wb_product_daily_returns. Always also clears the range to avoid stale rows
   * if WB later un-publishes a return entry.
   */
  async syncReturnsFromStatistics(daysBack = 7): Promise<void> {
    if (!await this.guardOrdersSync()) return;

    const fromDateStr = this.getMoscowDateStr(-daysBack);
    const dateFrom    = new Date(`${fromDateStr}T00:00:00+03:00`);
    this.logger.log(`Returns sync: from ${fromDateStr} (Moscow)`);

    type SaleRow = Awaited<ReturnType<WbStatisticsApiClient["fetchAllSales"]>>[number];
    let rows: SaleRow[];
    try {
      rows = await this.statisticsApiClient.fetchAllSales(dateFrom);
    } catch (err) {
      this.logger.warn(`Returns sync error: ${(err as Error).message}`);
      return;
    }

    // saleID starts with "R" → return. Use the `date` field as the customer-facing
    // event date (Moscow tz). Ignore anything older than fromDate.
    const counts = new Map<string, { nmId: number; returnDate: string; count: number }>();
    for (const r of rows) {
      if (typeof r.saleID !== "string" || !r.saleID.startsWith("R")) continue;
      if (!r.nmId || typeof r.date !== "string") continue;
      const dateOnly = r.date.slice(0, 10);
      if (dateOnly < fromDateStr) continue;
      const key = `${r.nmId}|${dateOnly}`;
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { nmId: r.nmId, returnDate: dateOnly, count: 1 });
    }

    const upsertRows = Array.from(counts.values()).map((c) => ({
      nmId: c.nmId,
      returnDate: c.returnDate,
      returnsCount: c.count,
    }));

    await this.wbClustersRepository.clearReturnsForDateRange(fromDateStr);
    if (upsertRows.length > 0) {
      await this.wbClustersRepository.upsertDailyReturns(upsertRows);
    }
    this.logger.log(`Returns sync done: ${upsertRows.length} product-day rows`);
  }

  /**
   * Downloads current stock balances from WB Statistics API and saves a daily snapshot.
   * Aggregates quantity across all warehouses per nmId. Run once at 01:00 MSK.
   */
  async syncStocksSnapshot(): Promise<void> {
    if (!appEnv.wbStocksSnapshotEnabled) return;
    if (!this.wbClustersRepository.isConfigured()) return;
    await this.wbClustersRepository.ensureSchema();
    const token = this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken;
    if (!token) { this.logger.warn("Stocks snapshot: WB_API_TOKEN not set, skip."); return; }

    // dateFrom 2 years ago — ensures WB returns all active stock rows
    const dateFrom = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
    const stockDate = this.getMoscowDateStr(0);
    this.logger.log(`Stocks snapshot: fetching for date ${stockDate}`);

    let rawRows: Awaited<ReturnType<WbStatisticsApiClient["fetchStocks"]>>;
    try {
      rawRows = await this.statisticsApiClient.fetchStocks(dateFrom);
    } catch (err) {
      this.logger.warn(`Stocks snapshot fetch error: ${(err as Error).message}`);
      return;
    }

    if (rawRows.length === 0) { this.logger.log("Stocks snapshot: empty response."); return; }

    // Aggregate: sum quantity across all warehouses per nmId
    const byNmId = new Map<number, number>();
    for (const r of rawRows) {
      byNmId.set(r.nmId, (byNmId.get(r.nmId) ?? 0) + r.quantity);
    }

    const rows = Array.from(byNmId.entries()).map(([nmId, quantity]) => ({
      nmId,
      stockDate,
      quantity,
    }));

    await this.wbClustersRepository.upsertDailyStocks(rows);
    this.logger.log(`Stocks snapshot done: ${rows.length} products saved for ${stockDate}`);
  }

  /** Returns latest stock quantity per nmId (for the inline table column). */
  async getLatestStocks(): Promise<{ nmId: number; quantity: number }[]> {
    if (!this.wbClustersRepository.isConfigured()) return [];
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getLatestStocks();
  }

  /** Returns the full stocks matrix (all dates × all products) for the frontend. */
  async getStocksMatrix(): Promise<{ nmId: number; stockDate: string; quantity: number }[]> {
    if (!this.wbClustersRepository.isConfigured()) return [];
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getStocksMatrix();
  }

  /**
   * Downloads current prices and seller discounts from WB Prices API
   * and saves a daily snapshot.
   */
  async syncPricesFromWb(): Promise<void> {
    if (!this.wbClustersRepository.isConfigured()) return;
    await this.wbClustersRepository.ensureSchema();
    const token = this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken;
    if (!token) { this.logger.warn("Prices sync: WB_API_TOKEN not set, skip."); return; }

    const priceDate = this.getMoscowDateStr(0);
    this.logger.log(`Prices sync: fetching for date ${priceDate}`);

    let goods: Awaited<ReturnType<WbPricesApiClient["fetchAllGoods"]>>;
    try {
      goods = await this.pricesApiClient.fetchAllGoods();
    } catch (err) {
      this.logger.warn(`Prices sync fetch error: ${(err as Error).message}`);
      return;
    }

    if (goods.length === 0) { this.logger.log("Prices sync: empty response."); return; }

    // Take the first size price as representative for the nmId (all sizes share the same discount)
    const rows = goods.flatMap((g) => {
      const firstSize = g.sizes[0];
      if (!firstSize || firstSize.price <= 0) return [];
      return [{ nmId: g.nmID, priceDate, price: firstSize.price, discount: g.discount }];
    });

    await this.wbClustersRepository.upsertDailyPrices(rows);
    this.logger.log(`Prices sync done: ${rows.length} products saved for ${priceDate}`);
  }

  /** Returns the latest price per nmId (price with seller discount). */
  async getLatestPrices(): Promise<{ nmId: number; price: number; discount: number }[]> {
    if (!this.wbClustersRepository.isConfigured()) return [];
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getLatestPrices();
  }

  /** Returns the full prices matrix (all dates × all products) for the frontend. */
  async getPricesMatrix(): Promise<{ nmId: number; priceDate: string; price: number; discount: number }[]> {
    if (!this.wbClustersRepository.isConfigured()) return [];
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getPricesMatrix();
  }

  // ─── Изменение цены с записью на маркетплейс WB ──────────────────────────────
  //
  // ⚠️ ОПАСНО: реально меняет цену на витрине WB. Вызывается ТОЛЬКО из явного
  // PUT .../price (действие пользователя) — ни один крон/синк сюда не заходит.
  // Скидку НЕ трогаем: двигаем только базовую цену под целевой итог «со скидкой».
  // No-op guard: если новая база совпала с текущей — в WB ничего не отправляем.

  private finalFromBase(base: number, discount: number): number {
    return Math.round(base * (1 - discount / 100) * 100) / 100;
  }

  /** Запрашивает изменение цены товара и отправляет его на маркетплейс WB. */
  async setProductPrice(nmId: number, targetFinal: number) {
    if (!this.wbClustersRepository.isConfigured()) {
      throw new Error("PostgreSQL не настроен.");
    }
    if (!Number.isFinite(targetFinal) || targetFinal <= 0) {
      throw new Error("Некорректная цена.");
    }
    await this.wbClustersRepository.ensureSchema();

    const latest = await this.wbClustersRepository.getLatestPrices();
    const current = latest.find((p) => p.nmId === nmId);
    if (!current) {
      throw new Error(`Нет текущей цены для товара #${String(nmId)} — сначала синхронизируйте цены.`);
    }
    const discount = current.discount;
    const currentBase = current.price;
    const currentFinal = this.finalFromBase(currentBase, discount);

    // Обратный пересчёт: целевой итог → целая базовая цена (скидка неизменна).
    // WB принимает только целую базу; фактическую цену «со скидкой» он считает сам
    // как base × (1 − discount/100) — она получается с копейками. Фиксируем именно
    // эту реальную цену (с копейками), а не округлённое введённое значение, чтобы
    // ячейка показывала ровно то, что установит WB.
    const newBase = Math.round(targetFinal / (1 - discount / 100));
    const actualFinal = this.finalFromBase(newBase, discount);

    const result = {
      nmId,
      desiredBasePrice: newBase,
      desiredDiscount: discount,
      desiredFinal: actualFinal,
      currentBasePrice: currentBase,
      currentFinal,
      lastError: null as string | null,
    };

    // Никакого no-op по снапшоту: пользователь может выставить любое значение
    // (в т.ч. равное исходной цене до правок) — оно должно примениться. Защита от
    // повторной отправки того же числа живёт на фронте (сравнение с тем, что в ячейке).

    await this.wbClustersRepository.upsertPriceChangeQueued({
      nmId,
      basePrice: newBase,
      discount,
      finalPrice: actualFinal,
    });

    this.wbClustersRepository
      .saveSystemChangeLogEntry({
        entityType: "price",
        nmId,
        entityLabel: `Товар #${String(nmId)}`,
        changeType: "set",
        oldValue: `${currentFinal.toFixed(2)} ₽ (база ${String(currentBase)})`,
        newValue: `${actualFinal.toFixed(2)} ₽ (база ${String(newBase)})`,
      })
      .catch(() => {/* non-critical */});

    try {
      const uploadId = await this.pricesApiClient.uploadPrice(nmId, newBase, discount);
      await this.wbClustersRepository.updatePriceChange(nmId, { syncStatus: "sending", uploadId });
      return { ...result, status: "sending" as const };
    } catch (err) {
      const message = (err as Error).message || "Ошибка отправки в WB";
      await this.wbClustersRepository.updatePriceChange(nmId, { syncStatus: "failed", lastError: message });
      this.logger.warn(`setProductPrice WB upload failed for ${String(nmId)}: ${message}`);
      return { ...result, status: "failed" as const, lastError: message };
    }
  }

  /**
   * Последние выставленные пользователем цены (overlay для таблицы) — чтобы ячейка
   * сразу и после перезагрузки показывала введённое значение. Без статусов/проверок:
   * по договорённости мы доверяем, что WB применяет цену, и не делаем readback.
   */
  async getProductPriceChangeStatuses() {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const items = await this.wbClustersRepository.getPriceChangeRows();
    return { items };
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
