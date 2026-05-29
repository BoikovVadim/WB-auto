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

const NMIDS_PER_BATCH = 20;       // WB API hard limit для /history
const PRODUCTS_PAGE_LIMIT = 1000; // макс размер страницы /products (2000 → 400)
const INTERVAL_MS     = 25_000;   // 3 req/min = 1 per 20s; +5s buffer (22s всё равно ловил 429)
const RATE_LIMIT_WAIT_MS = 60_000; // пауза перед повтором после 429
const MAX_429_RETRIES = 4;

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

/** Per-product aggregate over a period from POST /products (без nmIds, пагинация). */
export type SalesFunnelProductSummary = {
  nmId: number;
  orderCount: number;
  orderSum: number;
  cancelCount: number;
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

  /**
   * Сводка orderCount/orderSum/cancelCount по ВСЕМ товарам за период через
   * POST /products. В отличие от /history (макс 20 nmId на запрос) этот эндпоинт
   * НЕ требует списка nmId и пагинируется по `limit` (до 1000/страницу), поэтому
   * для «сегодня» обычно укладывается в ОДИН запрос вместо десятков батчей.
   * Возвращает только товары с активностью за период (нет показов → нет заказов).
   *
   * @param startDate "YYYY-MM-DD" Moscow
   * @param endDate   "YYYY-MM-DD" Moscow
   */
  async fetchProductsSummary(startDate: string, endDate: string): Promise<SalesFunnelProductSummary[]> {
    const all: SalesFunnelProductSummary[] = [];
    const MAX_PAGES = 50; // backstop: 50 × 1000 = 50k товаров
    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = await this.fetchProductsPage(startDate, endDate, page);
      all.push(...rows);
      if (rows.length < PRODUCTS_PAGE_LIMIT) break; // последняя страница
    }
    return all;
  }

  private async fetchProductsPage(
    startDate: string,
    endDate: string,
    page: number,
  ): Promise<SalesFunnelProductSummary[]> {
    for (let attempt = 0; ; attempt++) {
      await this.throttle();

      const token = this.getToken();
      if (!token) throw new Error("Analytics API token not configured (WB_API_TOKEN)");

      const controller = new AbortController();
      const timer = setTimeout(() => { controller.abort(); }, 60_000);

      try {
        const resp = await fetch(
          `${appEnv.wbSellerAnalyticsApiBaseUrl}/api/analytics/v3/sales-funnel/products`,
          {
            method: "POST",
            headers: { Authorization: token, "Content-Type": "application/json" },
            body: JSON.stringify({
              selectedPeriod: { start: startDate, end: endDate },
              brandNames: [],
              tagIds: [],
              subjectIds: [],
              page,
              limit: PRODUCTS_PAGE_LIMIT,
            }),
            signal: controller.signal,
          },
        );
        clearTimeout(timer);

        if (resp.status === 429) {
          if (attempt >= MAX_429_RETRIES) {
            const text = await resp.text().catch(() => "");
            throw new Error(`Analytics API 429 (исчерпаны ${MAX_429_RETRIES} ретраев): ${text}`);
          }
          await new Promise<void>((r) => { setTimeout(r, RATE_LIMIT_WAIT_MS); });
          continue;
        }

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          throw new Error(`Analytics API ${resp.status}: ${text}`);
        }

        const data = await resp.json() as {
          data?: { products?: { product?: { nmId?: number }; statistic?: { selected?: { orderCount?: number; orderSum?: number; cancelCount?: number } } }[] };
        };
        const products = data.data?.products ?? [];
        return products
          .map((p) => ({
            nmId: Number(p.product?.nmId) || 0,
            orderCount: Number(p.statistic?.selected?.orderCount) || 0,
            orderSum: Number(p.statistic?.selected?.orderSum) || 0,
            cancelCount: Number(p.statistic?.selected?.cancelCount) || 0,
          }))
          .filter((p) => p.nmId > 0);
      } catch (err) {
        clearTimeout(timer);
        throw err;
      }
    }
  }

  private async fetchBatch(
    startDate: string,
    endDate: string,
    nmIds: number[],
  ): Promise<SalesFunnelProductHistory[]> {
    // Лимит 3 req/min хрупкий — даже при 25-сек интервале WB иногда отдаёт 429.
    // На 429 ждём минуту и повторяем тот же батч (до MAX_429_RETRIES раз), чтобы
    // прогон по всему каталогу не падал целиком из-за одного троттла.
    for (let attempt = 0; ; attempt++) {
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

        if (resp.status === 429) {
          if (attempt >= MAX_429_RETRIES) {
            const text = await resp.text().catch(() => "");
            throw new Error(`Analytics API 429 (исчерпаны ${MAX_429_RETRIES} ретраев): ${text}`);
          }
          await new Promise<void>((r) => { setTimeout(r, RATE_LIMIT_WAIT_MS); });
          continue;
        }

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
}
