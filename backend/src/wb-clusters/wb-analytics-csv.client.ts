/**
 * WB Seller Analytics CSV client.
 * Host: seller-analytics-api.wildberries.ru
 * Auth: Analytics token category.
 *
 * DETAIL_HISTORY_REPORT: one ZIP download → all products × all days.
 * Fields: nmID, dt, ordersCount, cancelCount, ordersSumRub, ...
 *
 * Usage:
 *   1. POST /api/v2/nm-report/downloads  → task starts, returns "Началось формирование"
 *   2. GET  /api/v2/nm-report/downloads  → poll until status="SUCCESS"
 *   3. GET  /api/v2/nm-report/downloads/file/{id} → download ZIP
 *   4. Unzip → parse CSV → upsert into wb_product_daily_orders
 *
 * No nmId batching needed. Single report = entire catalog × date range.
 */

import { createHash } from "node:crypto";
import { promisify } from "node:util";
import yauzl from "yauzl";

export type AnalyticsCsvRow = {
  nmId: number;
  orderDate: string;   // "YYYY-MM-DD"
  ordersCount: number;
  cancelCount: number;
  ordersSum: number;
  buyoutsCount: number;
  buyoutsSum: number;
};

type ReportStatus = {
  id: string;
  status: "PROCESSING" | "SUCCESS" | "ERROR";
  name: string;
  size: number;
  startDate: string;
  endDate: string;
  createdAt: string;
};

const BASE = "https://seller-analytics-api.wildberries.ru";

/** Per-request timeout. WB sometimes accepts the request but never closes the socket;
 *  without an AbortController the whole sync hangs silently. */
const REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export class WbAnalyticsCsvClient {
  constructor(private readonly getToken: () => string) {}

  private get authHeaders() {
    return {
      Authorization: this.getToken(),
      "Content-Type": "application/json",
    };
  }

  /** Creates a DETAIL_HISTORY_REPORT task and returns the task ID. */
  async createReport(startDate: string, endDate: string): Promise<string> {
    const id = createHash("md5")
      .update(`detail_${startDate}_${endDate}_${Date.now()}`)
      .digest("hex")
      .slice(0, 8) + "-" +
      createHash("md5").update(startDate).digest("hex").slice(0, 4) + "-" +
      "4" + createHash("md5").update(endDate).digest("hex").slice(0, 3) + "-" +
      "a" + createHash("md5").update(startDate + endDate).digest("hex").slice(0, 3) + "-" +
      createHash("md5").update(endDate + startDate).digest("hex").slice(0, 12);

    const resp = await fetchWithTimeout(`${BASE}/api/v2/nm-report/downloads`, {
      method: "POST",
      headers: this.authHeaders,
      body: JSON.stringify({
        id,
        reportType: "DETAIL_HISTORY_REPORT",
        params: { startDate, endDate, timezone: "Europe/Moscow" },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`CSV report create ${resp.status}: ${text}`);
    }

    return id;
  }

  /**
   * Polls until the report is ready or timeout is reached.
   * Returns true if ready, false on timeout.
   *
   * WB жёстко лимитирует эндпоинт списка отчётов (нечастый 429). Поэтому:
   *   - поллим раз в 20 с, а не каждые 5 с (5-секундный поллинг сам провоцировал 429);
   *   - 429 на listReports НЕ фатален — это «подожди ещё», а не «отчёт сломался»:
   *     делаем увеличенную паузу и продолжаем поллинг до общего дедлайна.
   * Раньше первый же 429 ронял waitForReport, ночная сверка падала, и прошлые
   * дни не подтягивались к актуальным цифрам WB.
   */
  async waitForReport(reportId: string, timeoutMs = 5 * 60_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const pollMs = 20_000;
    const backoffMs = 60_000;
    while (Date.now() < deadline) {
      await new Promise<void>((r) => { setTimeout(r, pollMs); });
      let statuses: ReportStatus[];
      try {
        statuses = await this.listReports();
      } catch (err) {
        if ((err as Error).message.includes("429")) {
          await new Promise<void>((r) => { setTimeout(r, backoffMs); });
          continue;
        }
        throw err;
      }
      const task = statuses.find((s) => s.id === reportId);
      if (!task) continue;
      if (task.status === "SUCCESS") return true;
      if (task.status === "ERROR") throw new Error(`CSV report ${reportId} failed on WB side`);
    }
    return false;
  }

  /** Lists all generated reports for this seller. */
  async listReports(): Promise<ReportStatus[]> {
    const resp = await fetchWithTimeout(`${BASE}/api/v2/nm-report/downloads`, {
      headers: this.authHeaders,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`CSV report list ${resp.status}: ${text}`);
    }
    const json = await resp.json() as { data: ReportStatus[] };
    return json.data ?? [];
  }

  /**
   * Downloads the ZIP, extracts the CSV, and returns parsed rows.
   * The ZIP contains a single CSV with all products × all days.
   */
  async downloadAndParse(reportId: string): Promise<AnalyticsCsvRow[]> {
    const resp = await fetchWithTimeout(
      `${BASE}/api/v2/nm-report/downloads/file/${reportId}`,
      { headers: this.authHeaders },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`CSV report download ${resp.status}: ${text}`);
    }

    const buffer = await resp.arrayBuffer();
    const csvText = await extractCsvFromZip(Buffer.from(buffer));
    return parseCsv(csvText);
  }

  /**
   * Full flow: create → wait → download → parse.
   * Returns all order rows for the period.
   *
   * `waitTimeoutMs` — сколько ждать генерации отчёта на стороне WB. Годовой
   * DETAIL_HISTORY_REPORT (365 дней × все товары) часто генерится дольше 5 минут,
   * поэтому для полной сверки вызывающий код передаёт увеличенный таймаут.
   */
  async fetchOrdersReport(
    startDate: string,
    endDate: string,
    waitTimeoutMs = 5 * 60_000,
  ): Promise<AnalyticsCsvRow[]> {
    const token = this.getToken();
    if (!token) throw new Error("WB_API_TOKEN not configured");

    const reportId = await this.createReport(startDate, endDate);
    const ready = await this.waitForReport(reportId, waitTimeoutMs);
    if (!ready) {
      throw new Error(`CSV report ${reportId} timed out after ${Math.round(waitTimeoutMs / 60_000)} min`);
    }
    return this.downloadAndParse(reportId);
  }
}

// ─── ZIP / CSV helpers ────────────────────────────────────────────────────────

const fromBuffer = promisify(
  (buf: Buffer, opts: yauzl.Options, cb: (err: Error | null, zipfile: yauzl.ZipFile) => void) =>
    yauzl.fromBuffer(buf, opts, cb),
);

async function extractCsvFromZip(zipBuffer: Buffer): Promise<string> {
  const zipfile = await fromBuffer(zipBuffer, { lazyEntries: true });

  return new Promise<string>((resolve, reject) => {
    let found = false;

    zipfile.readEntry();

    zipfile.on("entry", (entry: yauzl.Entry) => {
      if (found) return;

      zipfile.openReadStream(entry, (err, stream) => {
        if (err || !stream) { reject(err ?? new Error("no stream")); return; }
        found = true;
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => { chunks.push(c); });
        stream.on("end", () => { resolve(Buffer.concat(chunks).toString("utf8")); });
        stream.on("error", reject);
      });
    });

    zipfile.on("error", reject);
    zipfile.on("end", () => {
      if (!found) reject(new Error("No CSV entry found in ZIP"));
    });
  });
}

function parseCsv(text: string): AnalyticsCsvRow[] {
  const lines = text.split("\n");
  if (lines.length < 2) return [];

  // Header: nmID,dt,openCardCount,addToCartCount,ordersCount,ordersSumRub,buyoutsCount,
  //          buyoutsSumRub,cancelCount,cancelSumRub,...
  const COL_NM_ID       = 0;
  const COL_DT          = 1;
  const COL_ORDERS      = 4;
  const COL_ORDERS_SUM  = 5;
  const COL_BUYOUTS     = 6;
  const COL_BUYOUTS_SUM = 7;
  const COL_CANCEL      = 8;

  const rows: AnalyticsCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    const parts = line.split(",");
    if (parts.length < 9) continue;

    const nmId       = Number(parts[COL_NM_ID]);
    const orderDate  = (parts[COL_DT] ?? "").trim();
    const ordersCount = Number(parts[COL_ORDERS] ?? "0");
    const ordersSum  = Number(parts[COL_ORDERS_SUM] ?? "0");
    const buyoutsCount = Number(parts[COL_BUYOUTS] ?? "0");
    const buyoutsSum   = Number(parts[COL_BUYOUTS_SUM] ?? "0");
    const cancelCount = Number(parts[COL_CANCEL] ?? "0");

    if (!nmId || !orderDate || !/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) continue;

    rows.push({ nmId, orderDate, ordersCount, cancelCount, ordersSum, buyoutsCount, buyoutsSum });
  }

  return rows;
}

