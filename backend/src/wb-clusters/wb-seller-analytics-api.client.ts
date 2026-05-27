/**
 * WB Seller Analytics API — Sales Funnel (Воронка продаж).
 * Host: seller-analytics-api.wildberries.ru
 * Auth: Analytics token category.
 *
 * Endpoint: POST /api/analytics/v3/sales-funnel/products/history
 * Returns orderCount per nmId per day — matches WB dashboard "Заказали товаров" exactly.
 *
 * API constraint: nmIds required (min 1, max 20 per request).
 * This client handles batching internally — caller passes any number of nmIds.
 *
 * Rate limit: 3 req/min (Personal/Service) → 1 request per 22s to stay safe.
 * Max period per request: 7 days without JAM subscription.
 * Data updates: once per hour.
 */

import { appEnv } from "../common/env";

const NMIDS_PER_BATCH = 20;       // WB API hard limit
const INTERVAL_MS     = 22_000;   // 3 req/min = 1 per 20s + 2s buffer

export type SalesFunnelDayEntry = {
  date: string;        // "YYYY-MM-DD"
  orderCount: number;
  orderSum: number;
  buyoutCount: number;
  buyoutPercent: number;
  addToCartConversion: number;
  cartToOrderConversion: number;
  openCount?: number;
  cartCount?: number;
  addToWishlistCount?: number;
};

export type SalesFunnelProductHistory = {
  product: {
    nmId: number;
    title: string;
    vendorCode: string;
    brandName?: string;
  };
  history: SalesFunnelDayEntry[];
};

export class WbSellerAnalyticsApiClient {
  private lastRequestAt = 0;

  constructor(private readonly getToken: () => string) {}

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const wait = INTERVAL_MS - elapsed;
    if (wait > 0) await new Promise<void>((r) => { setTimeout(r, wait); });
    this.lastRequestAt = Date.now();
  }

  /**
   * Fetches per-product per-day order counts for all given nmIds.
   * Splits into batches of 20 (WB API limit), requests sequentially with rate-limit throttle.
   *
   * @param startDate "YYYY-MM-DD" Moscow
   * @param endDate   "YYYY-MM-DD" Moscow
   * @param nmIds     all seller's nmIds (any length, batched internally)
   */
  async fetchSalesFunnelHistory(
    startDate: string,
    endDate: string,
    nmIds: number[],
  ): Promise<SalesFunnelProductHistory[]> {
    if (nmIds.length === 0) throw new Error("Analytics API: nmIds must not be empty");
    const all: SalesFunnelProductHistory[] = [];
    for (let i = 0; i < nmIds.length; i += NMIDS_PER_BATCH) {
      const batch = nmIds.slice(i, i + NMIDS_PER_BATCH);
      const results = await this.fetchBatch(startDate, endDate, batch);
      all.push(...results);
    }
    return all;
  }

  private async fetchBatch(
    startDate: string,
    endDate: string,
    nmIds: number[],
  ): Promise<SalesFunnelProductHistory[]> {
    await this.throttle();

    const token = this.getToken();
    if (!token) throw new Error("Analytics API token not configured (WB_API_TOKEN)");

    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, 60_000);

    try {
      const resp = await fetch(
        `${appEnv.wbSellerAnalyticsApiBaseUrl}/api/analytics/v3/sales-funnel/products/history`,
        {
          method: "POST",
          headers: { Authorization: token, "Content-Type": "application/json" },
          body: JSON.stringify({
            selectedPeriod: { start: startDate, end: endDate },
            nmIds,
            brandNames: [],
            tagIds: [],
            subjectIds: [],
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timer);

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Analytics API ${resp.status}: ${text}`);
      }

      const data = await resp.json() as SalesFunnelProductHistory[];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }
}
