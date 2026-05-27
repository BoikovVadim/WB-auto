/**
 * Bulk monthly JAM loader.
 *
 * Fetches /api/v2/search-report/product/search-texts for ALL nmIds in batches
 * of 50 using topOrderBy="orders" only, over the last 30 days as a single
 * aggregated range.  Stores results in wb_product_search_text_range_snapshots /
 * wb_product_search_text_range_rows using UNNEST for fast bulk inserts.
 *
 * Why this is fast:
 *   - Per-product JAM sync:  371 products × 2 calls × 6 s = ~74 min
 *   - This script:           8 batches × 1 call × 6 s  = ~48 s
 *
 * Prerequisites:
 *   - DATABASE_URL (or .env) pointing to production PostgreSQL (via SSH tunnel).
 *   - WB_API_TOKEN with seller-analytics-api.wildberries.ru access.
 *
 * Usage:
 *   cd backend
 *   DATABASE_URL=postgres://... WB_API_TOKEN=... \
 *     npx ts-node src/wb-clusters/fill-jam-bulk-monthly.ts
 *
 * Optional env:
 *   WB_JAM_BULK_BATCH_SIZE    nmIds per request (default: 50, max: 50)
 *   WB_JAM_BULK_INTERVAL_MS   pause between requests (default: 6000)
 *   WB_JAM_BULK_DAYS          lookback window in days (default: 30)
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

import { Client } from "pg";
import dotenv from "dotenv";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadEnv() {
  for (const f of [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), "..", ".env.local"),
  ]) {
    dotenv.config({ path: f, override: true });
  }
}

loadEnv();

const WB_API_BASE = "https://seller-analytics-api.wildberries.ru";
const ENDPOINT = "/api/v2/search-report/product/search-texts";
const BATCH_SIZE = Math.min(50, Number.parseInt(process.env.WB_JAM_BULK_BATCH_SIZE ?? "50", 10));
const INTERVAL_MS = Number.parseInt(process.env.WB_JAM_BULK_INTERVAL_MS ?? "6000", 10);
const LOOKBACK_DAYS = Number.parseInt(process.env.WB_JAM_BULK_DAYS ?? "30", 10);
const TOKEN = (process.env.WB_API_TOKEN ?? "").trim();

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function buildPeriod() {
  const today = new Date();

  // currentEnd = yesterday (fully finalized on WB side)
  const end = new Date(today);
  end.setDate(end.getDate() - 1);

  // currentStart = end - (LOOKBACK_DAYS - 1) so duration = exactly LOOKBACK_DAYS
  const start = new Date(end);
  start.setDate(start.getDate() - (LOOKBACK_DAYS - 1));

  // pastPeriod: same duration, directly before currentPeriod
  // pastEnd = currentStart - 1
  const pastEnd = new Date(start);
  pastEnd.setDate(pastEnd.getDate() - 1);
  // pastStart = pastEnd - (LOOKBACK_DAYS - 1)
  const pastStart = new Date(pastEnd);
  pastStart.setDate(pastStart.getDate() - (LOOKBACK_DAYS - 1));

  return {
    currentPeriod: { start: formatDate(start), end: formatDate(end) },
    pastPeriod: { start: formatDate(pastStart), end: formatDate(pastEnd) },
  };
}

// ---------------------------------------------------------------------------
// WB API
// ---------------------------------------------------------------------------

type SearchTextItem = {
  nmId: number;
  text: string;
  frequency: number | null;
  weekFrequency: number | null;
  avgPosition: { current: number | null; dynamics: number | null };
  orders: { current: number | null; dynamics: number | null };
  openCard: { current: number | null; dynamics: number | null };
  addToCart: { current: number | null; dynamics: number | null };
  openToCart: { current: number | null; dynamics: number | null };
};

function readNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readMetric(v: unknown) {
  const obj = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  return { current: readNum(obj.current), dynamics: readNum(obj.dynamics) };
}

function parseItems(response: unknown): SearchTextItem[] {
  const root = typeof response === "object" && response !== null
    ? (response as Record<string, unknown>)
    : {};
  const data = typeof root.data === "object" && root.data !== null
    ? (root.data as Record<string, unknown>)
    : {};
  const items = Array.isArray(data.items) ? data.items : [];

  return items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) => typeof item.nmId === "number")
    .map((item) => ({
      nmId: item.nmId as number,
      text: typeof item.text === "string" ? item.text.trim() : "",
      frequency: readNum(item.frequency),
      weekFrequency: readNum(item.weekFrequency),
      avgPosition: readMetric(item.avgPosition),
      orders: readMetric(item.orders),
      openCard: readMetric(item.openCard),
      addToCart: readMetric(item.addToCart),
      openToCart: readMetric(item.openToCart),
    }))
    .filter((item) => item.text.length > 0);
}

async function fetchBatch(
  nmIds: number[],
  period: ReturnType<typeof buildPeriod>,
): Promise<SearchTextItem[]> {
  const body = {
    currentPeriod: period.currentPeriod,
    pastPeriod: period.pastPeriod,
    nmIds,
    topOrderBy: "orders",
    includeSubstitutedSKUs: true,
    includeSearchTexts: true,
    orderBy: { field: "avgPosition", mode: "asc" },
    limit: 30,
  };

  const response = await fetch(`${WB_API_BASE}${ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: TOKEN,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`WB API HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = await response.json();
  return parseItems(json);
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function normalizeQuery(text: string) {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

async function saveSnapshotForNmId(
  client: Client,
  nmId: number,
  startDate: string,
  endDate: string,
  items: SearchTextItem[],
) {
  // Deduplicate by normalized query text
  const seen = new Map<string, SearchTextItem>();
  for (const item of items) {
    const key = normalizeQuery(item.text);
    if (!seen.has(key)) seen.set(key, item);
  }
  const deduped = [...seen.entries()];

  await client.query("BEGIN");
  try {
    // Reuse existing snapshot_key to avoid breaking the FK from rows → snapshots.
    // Generating a new UUID and updating the PK would orphan existing child rows.
    const existing = await client.query<{ snapshot_key: string }>(
      `SELECT snapshot_key FROM public.wb_product_search_text_range_snapshots
       WHERE nm_id = $1 AND start_date = $2::date AND end_date = $3::date`,
      [nmId, startDate, endDate],
    );
    const snapshotKey = existing.rows[0]?.snapshot_key ?? randomUUID();

    // Upsert snapshot header (keep same key on conflict)
    await client.query(
      `INSERT INTO public.wb_product_search_text_range_snapshots
         (snapshot_key, nm_id, start_date, end_date, row_count, synced_at)
       VALUES ($1, $2, $3::date, $4::date, $5, NOW())
       ON CONFLICT (nm_id, start_date, end_date) DO UPDATE SET
         row_count = EXCLUDED.row_count,
         synced_at = NOW()`,
      [snapshotKey, nmId, startDate, endDate, deduped.length],
    );

    // Delete old rows (safe: same snapshot_key)
    await client.query(
      `DELETE FROM public.wb_product_search_text_range_rows WHERE snapshot_key = $1`,
      [snapshotKey],
    );

    if (deduped.length > 0) {
      // Bulk insert via UNNEST
      const rowKeys         = deduped.map(([nq]) => `${snapshotKey}:${nq}`);
      const queryTexts      = deduped.map(([, i]) => i.text);
      const normQueryTexts  = deduped.map(([nq]) => nq);
      const frequencies     = deduped.map(([, i]) => i.frequency);
      const weekFreqs       = deduped.map(([, i]) => i.weekFrequency);
      const avgPosCur       = deduped.map(([, i]) => i.avgPosition.current);
      const avgPosDyn       = deduped.map(([, i]) => i.avgPosition.dynamics);
      const ordersCur       = deduped.map(([, i]) => i.orders.current);
      const ordersDyn       = deduped.map(([, i]) => i.orders.dynamics);
      const openCardCur     = deduped.map(([, i]) => i.openCard.current);
      const openCardDyn     = deduped.map(([, i]) => i.openCard.dynamics);
      const addToCartCur    = deduped.map(([, i]) => i.addToCart.current);
      const addToCartDyn    = deduped.map(([, i]) => i.addToCart.dynamics);
      const openToCartCur   = deduped.map(([, i]) => i.openToCart.current);
      const openToCartDyn   = deduped.map(([, i]) => i.openToCart.dynamics);

      await client.query(
        `INSERT INTO public.wb_product_search_text_range_rows
           (row_key, snapshot_key,
            query_text, normalized_query_text,
            frequency, week_frequency,
            avg_position_current, avg_position_dynamics,
            orders_current, orders_dynamics,
            open_card_current, open_card_dynamics,
            add_to_cart_current, add_to_cart_dynamics,
            open_to_cart_current, open_to_cart_dynamics,
            synced_at)
         SELECT
           UNNEST($1::text[]), $2,
           UNNEST($3::text[]), UNNEST($4::text[]),
           UNNEST($5::numeric[]), UNNEST($6::numeric[]),
           UNNEST($7::numeric[]), UNNEST($8::numeric[]),
           UNNEST($9::numeric[]), UNNEST($10::numeric[]),
           UNNEST($11::numeric[]), UNNEST($12::numeric[]),
           UNNEST($13::numeric[]), UNNEST($14::numeric[]),
           UNNEST($15::numeric[]), UNNEST($16::numeric[]),
           NOW()
         ON CONFLICT (snapshot_key, normalized_query_text) DO UPDATE SET
           query_text              = EXCLUDED.query_text,
           frequency               = EXCLUDED.frequency,
           week_frequency          = EXCLUDED.week_frequency,
           avg_position_current    = EXCLUDED.avg_position_current,
           avg_position_dynamics   = EXCLUDED.avg_position_dynamics,
           orders_current          = EXCLUDED.orders_current,
           orders_dynamics         = EXCLUDED.orders_dynamics,
           open_card_current       = EXCLUDED.open_card_current,
           open_card_dynamics      = EXCLUDED.open_card_dynamics,
           add_to_cart_current     = EXCLUDED.add_to_cart_current,
           add_to_cart_dynamics    = EXCLUDED.add_to_cart_dynamics,
           open_to_cart_current    = EXCLUDED.open_to_cart_current,
           open_to_cart_dynamics   = EXCLUDED.open_to_cart_dynamics,
           synced_at               = NOW()`,
        [
          rowKeys, snapshotKey,
          queryTexts, normQueryTexts,
          frequencies, weekFreqs,
          avgPosCur, avgPosDyn,
          ordersCur, ordersDyn,
          openCardCur, openCardDyn,
          addToCartCur, addToCartDyn,
          openToCartCur, openToCartDyn,
        ],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }

  return deduped.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function loadNmIds(client: Client): Promise<number[]> {
  const { rows } = await client.query<{ nm_id: string }>(
    `SELECT DISTINCT cp.nm_id::text AS nm_id
     FROM public.wb_campaign_products cp
     JOIN public.wb_campaigns c ON c.advert_id = cp.advert_id
     WHERE c.campaign_status IN (9, 11)`,
  );
  return rows.map((r) => Number(r.nm_id));
}

async function main() {
  if (!TOKEN) {
    console.error("WB_API_TOKEN is not set. Add it to .env or export it before running.");
    process.exitCode = 1;
    return;
  }

  const connStr = (process.env.DATABASE_URL ?? "").trim();
  if (!connStr) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString: connStr });
  await client.connect();
  console.log("Connected to PostgreSQL.");

  try {
    const period = buildPeriod();
    console.log(
      `Period: ${period.currentPeriod.start} → ${period.currentPeriod.end} (${LOOKBACK_DAYS} days)`,
    );

    const nmIds = await loadNmIds(client);
    console.log(
      `Found ${nmIds.length} unique nmIds (active/paused campaigns only).\n` +
      `Batch size: ${BATCH_SIZE}, interval: ${INTERVAL_MS}ms, topOrderBy: orders\n` +
      `Estimated requests: ${Math.ceil(nmIds.length / BATCH_SIZE)} | ` +
      `Estimated time: ~${Math.ceil((Math.ceil(nmIds.length / BATCH_SIZE) * INTERVAL_MS) / 1000)}s\n`,
    );

    const batches: number[][] = [];
    for (let i = 0; i < nmIds.length; i += BATCH_SIZE) {
      batches.push(nmIds.slice(i, i + BATCH_SIZE));
    }

    let totalRows = 0;
    let totalNmIds = 0;
    let failed = 0;
    const captureStart = Date.now();

    for (const [batchIndex, batch] of batches.entries()) {
      process.stdout.write(
        `[${batchIndex + 1}/${batches.length}] fetching ${batch.length} nmIds...`,
      );

      let items: SearchTextItem[];
      try {
        items = await fetchBatch(batch, period);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(` FAILED: ${msg}`);
        failed += batch.length;
        if (msg.includes("429")) {
          console.warn("  429 quota hit — waiting 65s before retrying...");
          await sleep(65_000);
          // retry once
          try {
            items = await fetchBatch(batch, period);
          } catch {
            await sleep(INTERVAL_MS);
            continue;
          }
        } else {
          await sleep(INTERVAL_MS);
          continue;
        }
      }

      // Group by nmId
      const byNmId = new Map<number, SearchTextItem[]>();
      for (const item of items) {
        if (!byNmId.has(item.nmId)) byNmId.set(item.nmId, []);
        byNmId.get(item.nmId)!.push(item);
      }

      // Save to DB
      let batchRows = 0;
      for (const nmId of batch) {
        const nmItems = byNmId.get(nmId) ?? [];
        const saved = await saveSnapshotForNmId(
          client,
          nmId,
          period.currentPeriod.start,
          period.currentPeriod.end,
          nmItems,
        );
        batchRows += saved;
        totalNmIds++;
      }

      totalRows += batchRows;
      failed = Math.max(0, failed - batch.length);

      const elapsed = Math.round((Date.now() - captureStart) / 1000);
      console.log(
        ` ok — ${batchRows} rows saved | total: ${totalNmIds}/${nmIds.length} nmIds, ${totalRows} rows [${elapsed}s]`,
      );

      if (batchIndex < batches.length - 1) {
        await sleep(INTERVAL_MS);
      }
    }

    console.log(
      `\nDone. ${totalNmIds} nmIds processed, ${totalRows} rows stored.` +
      (failed > 0 ? ` ${failed} failed.` : ""),
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(msg);
  process.exitCode = 1;
});
