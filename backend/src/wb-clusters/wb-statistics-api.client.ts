/**
 * Minimal WB Statistics API client.
 * Base URL: https://statistics-api.wildberries.ru
 * Auth: same WB_API_TOKEN as the analytics API.
 * Rate limit: 1 request per minute — enforced via throttle (wbStatisticsApiMinIntervalMs).
 *
 * flag=1 behavior: returns ALL orders placed on the exact calendar date (Moscow timezone)
 * derived from dateFrom. One API call = one day's worth of gross orders.
 */

import { appEnv } from "../common/env";

export type WbStockRow = {
  lastChangeDate: string;
  warehouseName: string;
  barcode: string;
  nmId: number;
  subject: string;
  supplierArticle: string;
  brand: string;
  techSize: string;
  price: number;
  discount: number;
  isSupply: boolean;
  isRealization: boolean;
  quantityFull: number;
  quantity: number;         // available for sale (not in orders, not reserved)
  inWayToClient: number;
  inWayFromClient: number;
  category: string;
  daysOnSite: number;
};

export type WbOrderRow = {
  date: string;          // "2024-01-15T10:00:00+03:00" — order placement date, Moscow tz
  lastChangeDate: string;
  warehouseName: string;
  countryName: string;
  oblastOkrugName: string;
  regionName: string;
  supplierArticle: string;
  nmId: number;
  barcode: string;
  category: string;
  subject: string;
  brand: string;
  techSize: string;
  incomeID: number;
  isSupply: boolean;
  isRealization: boolean;
  totalPrice: number;
  discountPercent: number;
  spp: number;
  finishedPrice: number;
  priceWithDisc: number;
  isCancel: boolean;
  cancelDate: string;
  orderType: string;
  sticker: string;
  gNumber: string;
  srid: string;
};

export class WbStatisticsApiClient {
  private lastRequestAt = 0;

  constructor(private readonly getToken: () => string) {}

  /**
   * Downloads ALL orders changed since `dateFrom` using flag=0 (lastChangeDate cursor).
   * One request covers everything — no per-day calls, no nmId batching.
   * Paginates automatically if WB returns a full 80k-row page.
   *
   * The `date` field in each row contains the actual order placement date in Moscow timezone.
   * Aggregation is done via SQL after inserting raw rows into wb_orders_raw.
   */
  /**
   * Downloads ALL orders changed since dateFrom using flag=0 (sorted by lastChangeDate).
   * flag=0: returns all orders where lastChangeDate >= dateFrom, covering ALL statuses.
   * For a 7-day window with ~1500 orders/day the response is ~10k rows (well under 80k limit).
   * Paginates automatically if the response hits the 80k-row limit.
   *
   * Note: flag=1 returns orders for a SINGLE calendar day only (= date of dateFrom).
   * For a multi-day range flag=0 is the correct choice.
   */
  async fetchAllOrdersByDate(dateFrom: Date): Promise<WbOrderRow[]> {
    await this.throttle();
    const rows = await this.fetchOrdersPage(dateFrom, 0);

    if (rows.length < 80000) return rows;

    // Paginate: keep fetching while WB returns full pages
    const allRows = [...rows];
    let cursor = new Date(rows[rows.length - 1]!.lastChangeDate);

    for (;;) {
      await this.throttle();
      const page = await this.fetchOrdersPage(cursor, 0);
      if (page.length === 0) break;
      allRows.push(...page);
      if (page.length < 80000) break;
      const last = page[page.length - 1];
      if (!last) break;
      const next = new Date(last.lastChangeDate);
      if (isNaN(next.getTime()) || next <= cursor) break;
      cursor = next;
    }

    return allRows;
  }

  /**
   * Fetches all orders placed on a specific Moscow calendar date using flag=1.
   * WB Statistics API flag=1: returns orders for the exact date derived from dateFrom.
   * One call per day — the correct way to get accurate gross order counts per day.
   *
   * @param moscowDateStr — "YYYY-MM-DD" in Moscow timezone (e.g. "2026-05-21")
   */
  async fetchOrdersForDay(moscowDateStr: string): Promise<WbOrderRow[]> {
    // Pass midnight Moscow as dateFrom so WB knows which calendar day we want
    const dateFrom = new Date(`${moscowDateStr}T00:00:00+03:00`);
    await this.throttle();
    const rows = await this.fetchOrdersPage(dateFrom, 1);

    // If WB returns a full 80k-row page, paginate within the same day
    if (rows.length < 80000) return rows;

    const allRows = [...rows];
    let cursor = new Date(rows[rows.length - 1]!.lastChangeDate);

    for (;;) {
      await this.throttle();
      const page = await this.fetchOrdersPage(cursor, 1);
      if (page.length === 0) break;
      const dayRows = page.filter((r) => r.date.slice(0, 10) === moscowDateStr);
      allRows.push(...dayRows);
      if (dayRows.length < page.length) break; // spilled into next day
      if (page.length < 80000) break;
      const last = page[page.length - 1];
      if (!last) break;
      const next = new Date(last.lastChangeDate);
      if (isNaN(next.getTime()) || next <= cursor) break;
      cursor = next;
    }

    return allRows;
  }

  private async fetchOrdersPage(dateFrom: Date, flag: 0 | 1): Promise<WbOrderRow[]> {
    const token = this.getToken();
    if (!token) throw new Error("WB Statistics API token not configured (WB_API_TOKEN)");

    const dateFromStr = dateFrom.toISOString();
    const url = new URL(`${appEnv.wbStatisticsApiBaseUrl}/api/v1/supplier/orders`);
    url.searchParams.set("dateFrom", dateFromStr);
    if (flag) url.searchParams.set("flag", String(flag));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(); }, appEnv.wbStatisticsApiTimeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`WB Statistics API ${response.status}: ${body}`);
      }

      const data = await response.json() as WbOrderRow[];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  /**
   * Downloads ALL current stock balances from WB Statistics API.
   * Pass dateFrom far in the past (e.g. 2 years ago) to receive all active stock rows.
   * Aggregation (sum by nmId across warehouses) is done by the caller.
   */
  async fetchStocks(dateFrom: Date): Promise<WbStockRow[]> {
    await this.throttle();
    const token = this.getToken();
    if (!token) throw new Error("WB Statistics API token not configured (WB_API_TOKEN)");

    const url = new URL(`${appEnv.wbStatisticsApiBaseUrl}/api/v1/supplier/stocks`);
    url.searchParams.set("dateFrom", dateFrom.toISOString());

    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(); }, appEnv.wbStatisticsApiTimeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: token, "Content-Type": "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`WB Statistics stocks API ${response.status}: ${body}`);
      }

      const data = await response.json() as WbStockRow[];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const wait = appEnv.wbStatisticsApiMinIntervalMs - elapsed;
    if (wait > 0) await new Promise<void>((r) => { setTimeout(r, wait); });
    this.lastRequestAt = Date.now();
  }
}
