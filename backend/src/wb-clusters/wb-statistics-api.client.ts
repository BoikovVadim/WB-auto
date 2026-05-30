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

/**
 * Row returned by /api/v1/supplier/sales. Same shape as orders, plus `saleID`.
 * saleID starting with "S" — выкуп (sale), "R" — возврат (return).
 * priceWithDisc / finishedPrice могут быть отрицательными для возвратов.
 */
export type WbSaleRow = {
  date: string;
  lastChangeDate: string;
  warehouseName: string;
  nmId: number;
  supplierArticle: string;
  saleID: string;
  totalPrice: number;
  discountPercent: number;
  finishedPrice: number;
  priceWithDisc: number;
  forPay: number;
  srid: string;
};

/**
 * Строка отчёта о реализации (/api/v5/supplier/reportDetailByPeriod) — он же
 * «финансовый отчёт» WB. Одна строка = одна операция реализации (продажа/возврат)
 * по товару внутри отчётной недели (date_from..date_to, обычно пн–вс).
 * Здесь объявлены только поля, нужные для фактического эквайринга по товару:
 *   acquiring_fee  — эквайринг (комиссия за приём платежа) в ₽ по операции,
 *   retail_amount  — розничная стоимость операции (база, к которой WB применил эквайринг),
 *   rrd_id         — курсор пагинации (передаётся как rrdid в следующий запрос).
 * Возвраты приходят с отрицательными суммами → суммирование даёт net-эквайринг за неделю.
 */
export type WbReportDetailRow = {
  realizationreport_id: number;
  date_from: string;   // ISO — начало отчётной недели
  date_to: string;     // ISO — конец отчётной недели
  rrd_id: number;      // курсор пагинации
  nm_id: number;
  retail_amount: number;
  acquiring_fee: number;
  doc_type_name?: string;       // "Продажа" / "Возврат"
  supplier_oper_name?: string;
};

export class WbStatisticsApiClient {
  private lastRequestAt = 0;

  constructor(private readonly getToken: () => string) {}

  /**
   * Итерирует отчёт о реализации за период [dateFrom, dateTo] (даты "YYYY-MM-DD",
   * границы трактуются WB как отчётные даты) ПОСТРАНИЧНО. Пагинация по курсору rrdid:
   * на каждой странице берём последний rrd_id и шлём его как rrdid, пока WB не вернёт
   * пустую страницу или меньше лимита. Тот же лимит statistics-api (1 req/min) — каждый
   * запрос проходит через общий throttle инстанса.
   *
   * Отдаём генератором (а не одним массивом), чтобы потребитель сворачивал страницы по
   * мере поступления и НЕ держал весь отчёт в памяти. Финансовый отчёт WB за неделю —
   * это десятки/сотни тысяч «жирных» строк (десятки полей каждая); парсинг целиком
   * (LIMIT=100k) одним JSON.parse выбивал процесс за лимит heap (--max-old-space-size=768)
   * с fatal OOM и ронял весь backend. Маленькая страница (LIMIT) держит пик памяти
   * одного JSON.parse в безопасных рамках.
   */
  async *iterateReportDetailByPeriod(
    dateFrom: string,
    dateTo: string,
  ): AsyncGenerator<WbReportDetailRow[]> {
    const LIMIT = 10000;
    let rrdid = 0;

    for (;;) {
      await this.throttle();
      const page = await this.fetchReportDetailPage(dateFrom, dateTo, rrdid, LIMIT);
      if (page.length === 0) break;
      yield page;
      const last = page[page.length - 1];
      if (!last || typeof last.rrd_id !== "number") break;
      if (last.rrd_id <= rrdid) break; // защита от зацикливания
      if (page.length < LIMIT) break;
      rrdid = last.rrd_id;
    }
  }

  private async fetchReportDetailPage(
    dateFrom: string,
    dateTo: string,
    rrdid: number,
    limit: number,
  ): Promise<WbReportDetailRow[]> {
    const token = this.getToken();
    if (!token) throw new Error("WB Statistics API token not configured (WB_API_TOKEN)");

    const url = new URL(`${appEnv.wbStatisticsApiBaseUrl}/api/v5/supplier/reportDetailByPeriod`);
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);
    url.searchParams.set("rrdid", String(rrdid));
    url.searchParams.set("limit", String(limit));

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
        throw new Error(`WB Statistics reportDetailByPeriod ${response.status}: ${body}`);
      }
      const data = await response.json() as WbReportDetailRow[];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

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
    // flag=1: WB берёт ТОЛЬКО дату из dateFrom (время игнорируется), причём из
    // строки, которую мы шлём через dateFrom.toISOString() — т.е. из UTC-даты.
    // Если послать полночь по Москве (`${d}T00:00:00+03:00`), toISOString даёт
    // предыдущий день в UTC (21:00Z), и WB отдаёт заказы за ВЧЕРА → данные «сегодня»
    // оказываются вчерашними и замороженными. Берём полдень по Москве (09:00Z) —
    // UTC-дата гарантированно совпадает с нужным московским днём (запас ±3 ч).
    const dateFrom = new Date(`${moscowDateStr}T12:00:00+03:00`);
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

  /**
   * Downloads ALL sales + returns changed since `dateFrom` (flag=0 cursor).
   * Returns: returns are rows whose saleID starts with "R".
   * Paginates automatically if the response hits the 80k-row limit.
   */
  async fetchAllSales(dateFrom: Date): Promise<WbSaleRow[]> {
    await this.throttle();
    const rows = await this.fetchSalesPage(dateFrom);
    if (rows.length < 80000) return rows;

    const all = [...rows];
    let cursor = new Date(rows[rows.length - 1]!.lastChangeDate);
    for (;;) {
      await this.throttle();
      const page = await this.fetchSalesPage(cursor);
      if (page.length === 0) break;
      all.push(...page);
      if (page.length < 80000) break;
      const last = page[page.length - 1];
      if (!last) break;
      const next = new Date(last.lastChangeDate);
      if (isNaN(next.getTime()) || next <= cursor) break;
      cursor = next;
    }
    return all;
  }

  private async fetchSalesPage(dateFrom: Date): Promise<WbSaleRow[]> {
    const token = this.getToken();
    if (!token) throw new Error("WB Statistics API token not configured (WB_API_TOKEN)");

    const url = new URL(`${appEnv.wbStatisticsApiBaseUrl}/api/v1/supplier/sales`);
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
        throw new Error(`WB Statistics sales API ${response.status}: ${body}`);
      }
      const data = await response.json() as WbSaleRow[];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
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
