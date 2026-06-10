import { appEnv } from "../common/env";
import { WbSellerAnalyticsApiClient } from "./wb-seller-analytics-api.client";
import { WbAnalyticsCsvClient } from "./wb-analytics-csv.client";
import { WbStatisticsApiClient } from "./wb-statistics-api.client";
import { WbPricesApiClient } from "./wb-prices-api.client";
import { WbClustersServiceSyncInternals } from "./wb-clusters.service.sync-internals";

/**
 * Данные-секция, часть 1/3: смены-лог (чтение), себестоимость, матрицы заказов и их синк.
 * Вынесено из разросшегося wb-clusters.service по объёму — методы остаются методами
 * (инстанс-`this`), наследуются концертом без изменений вызовов. Сюда же переехали общие
 * API-клиенты и date/guard-хелперы: их используют все три части (BaseB/BaseC — наследники).
 */
export abstract class WbClustersServiceDataOrdersRevenue extends WbClustersServiceSyncInternals {
  protected readonly analyticsClient = new WbSellerAnalyticsApiClient(
    () => this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken,
  );
  protected readonly analyticsCsvClient = new WbAnalyticsCsvClient(
    () => this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken,
  );
  protected readonly statisticsApiClient = new WbStatisticsApiClient(
    () => this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken,
  );
  protected readonly pricesApiClient = new WbPricesApiClient(
    () => this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken,
  );

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

  async getUnifiedChangeLog(limit = 500, cursor?: string | null) {
    if (!this.wbClustersRepository.isConfigured()) {
      return { entries: [] };
    }
    await this.wbClustersRepository.ensureSchema();
    const entries = await this.wbClustersRepository.getUnifiedChangeLog(limit, cursor);
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

  protected getMoscowDateStr(offsetDays = 0): string {
    const d = new Date(Date.now() + 3 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }

  protected async guardOrdersSync(): Promise<boolean> {
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

}
