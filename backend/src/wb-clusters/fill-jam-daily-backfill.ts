/**
 * Daily JAM backfill script.
 *
 * Downloads /api/v2/search-report/product/search-texts for ALL nmIds in
 * batches of 50 for each individual calendar day over the last 30 days.
 * Stores per-day snapshots in wb_product_search_text_range_snapshots /
 * wb_product_search_text_range_rows (start_date = end_date = day).
 *
 * Resume-safe: days that already have data in DB are skipped automatically.
 * Empty responses from WB (no rows for a day) are skipped and logged.
 *
 * Why batches of 50:
 *   WB API hard limit is 50 nmIds per request. For 900 products → 18 batches
 *   per day. Each batch issues TWO requests (topOrderBy openCard + orders),
 *   matching the live syncOneDayJam, then merges/dedups the two query lists.
 *
 * Prerequisites:
 *   - DATABASE_URL pointing to production PostgreSQL (or via SSH tunnel).
 *   - WB_API_TOKEN with seller-analytics-api.wildberries.ru access.
 *
 * Usage:
 *   cd backend
 *   DATABASE_URL=postgres://... WB_API_TOKEN=... \
 *     npx ts-node src/wb-clusters/fill-jam-daily-backfill.ts
 *
 * Optional env vars:
 *   WB_JAM_BULK_BATCH_SIZE    nmIds per request (default: 50, max: 50)
 *   WB_JAM_BULK_INTERVAL_MS   pause between requests in ms (default: 6000)
 *   WB_JAM_BACKFILL_DAYS      how many days back to fill (default: 30)
 *   WB_JAM_BACKFILL_FROM      specific start date YYYY-MM-DD (overrides days)
 *   WB_JAM_BACKFILL_TO        specific end date YYYY-MM-DD (default: yesterday)
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
const BACKFILL_DAYS = Number.parseInt(process.env.WB_JAM_BACKFILL_DAYS ?? "30", 10);
const TOKEN = (process.env.WB_API_TOKEN ?? "").trim();

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

/** Build the list of days to fill, from oldest to newest. */
function buildDayList(): string[] {
  const envFrom = (process.env.WB_JAM_BACKFILL_FROM ?? "").trim();
  const envTo = (process.env.WB_JAM_BACKFILL_TO ?? "").trim();

  const yesterday = addDays(new Date(), -1);
  const toDate = envTo ? new Date(envTo) : yesterday;
  const fromDate = envFrom
    ? new Date(envFrom)
    : addDays(toDate, -(BACKFILL_DAYS - 1));

  const days: string[] = [];
  let cur = new Date(fromDate);
  while (cur <= toDate) {
    days.push(formatDate(cur));
    cur = addDays(cur, 1);
  }
  return days;
}

// ---------------------------------------------------------------------------
// WB API types
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

async function fetchOneTopOrderBy(
  nmIds: number[],
  day: string,
  topOrderBy: "openCard" | "orders",
): Promise<SearchTextItem[]> {
  // pastPeriod = day before (same 1-day window, shifted back by 1)
  const dayDate = new Date(day);
  const pastDay = formatDate(addDays(dayDate, -1));

  const body = {
    currentPeriod: { start: day, end: day },
    pastPeriod: { start: pastDay, end: pastDay },
    nmIds,
    topOrderBy,
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

function pickGreater(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function mergeMetric(
  a: { current: number | null; dynamics: number | null },
  b: { current: number | null; dynamics: number | null },
) {
  return {
    current: pickGreater(a.current, b.current),
    dynamics: pickGreater(a.dynamics, b.dynamics),
  };
}

/**
 * Issues BOTH topOrderBy variants (openCard + orders) and merges them per
 * (nmId, normalized text), taking the greater of each numeric field — the same
 * shape the live syncOneDayJam uses (preferredTopOrderBy "openCard", count 2).
 * A single topOrderBy:"orders" request would permanently miss top-by-openCard
 * queries on backfilled historical days.
 */
async function fetchBatch(
  nmIds: number[],
  day: string,
): Promise<SearchTextItem[]> {
  const merged = new Map<string, SearchTextItem>();
  for (const topOrderBy of ["openCard", "orders"] as const) {
    const items = await fetchOneTopOrderBy(nmIds, day, topOrderBy);
    for (const item of items) {
      const key = `${item.nmId}:${normalizeQuery(item.text)}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, item);
        continue;
      }
      merged.set(key, {
        nmId: existing.nmId,
        text: existing.text.length >= item.text.length ? existing.text : item.text,
        frequency: pickGreater(existing.frequency, item.frequency),
        weekFrequency: pickGreater(existing.weekFrequency, item.weekFrequency),
        avgPosition: mergeMetric(existing.avgPosition, item.avgPosition),
        orders: mergeMetric(existing.orders, item.orders),
        openCard: mergeMetric(existing.openCard, item.openCard),
        addToCart: mergeMetric(existing.addToCart, item.addToCart),
        openToCart: mergeMetric(existing.openToCart, item.openToCart),
      });
    }
    // Respect the WB rate limit between the two requests in this batch, just
    // like the inter-batch pause in the main loop.
    if (topOrderBy === "openCard") {
      await sleep(INTERVAL_MS);
    }
  }
  return [...merged.values()];
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function normalizeQuery(text: string) {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

/** Returns how many nmIds already have a snapshot for this day. */
async function countExistingSnapshots(client: Client, day: string): Promise<number> {
  const result = await client.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM public.wb_product_search_text_range_snapshots
     WHERE start_date = $1::date AND end_date = $1::date`,
    [day],
  );
  return Number(result.rows[0]?.cnt ?? 0);
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

async function saveSnapshotForNmId(
  client: Client,
  nmId: number,
  day: string,
  items: SearchTextItem[],
): Promise<number> {
  const seen = new Map<string, SearchTextItem>();
  for (const item of items) {
    const key = normalizeQuery(item.text);
    if (!seen.has(key)) seen.set(key, item);
  }
  const deduped = [...seen.entries()];

  await client.query("BEGIN");
  try {
    const existing = await client.query<{ snapshot_key: string }>(
      `SELECT snapshot_key FROM public.wb_product_search_text_range_snapshots
       WHERE nm_id = $1 AND start_date = $2::date AND end_date = $2::date`,
      [nmId, day],
    );
    const snapshotKey = existing.rows[0]?.snapshot_key ?? randomUUID();

    await client.query(
      `INSERT INTO public.wb_product_search_text_range_snapshots
         (snapshot_key, nm_id, start_date, end_date, row_count, synced_at)
       VALUES ($1, $2, $3::date, $3::date, $4, NOW())
       ON CONFLICT (nm_id, start_date, end_date) DO UPDATE SET
         row_count = EXCLUDED.row_count,
         synced_at = NOW()`,
      [snapshotKey, nmId, day, deduped.length],
    );

    await client.query(
      `DELETE FROM public.wb_product_search_text_range_rows WHERE snapshot_key = $1`,
      [snapshotKey],
    );

    if (deduped.length > 0) {
      const rowKeys        = deduped.map(([nq]) => `${snapshotKey}:${nq}`);
      const queryTexts     = deduped.map(([, i]) => i.text);
      const normQueryTexts = deduped.map(([nq]) => nq);
      const frequencies    = deduped.map(([, i]) => i.frequency);
      const weekFreqs      = deduped.map(([, i]) => i.weekFrequency);
      const avgPosCur      = deduped.map(([, i]) => i.avgPosition.current);
      const avgPosDyn      = deduped.map(([, i]) => i.avgPosition.dynamics);
      const ordersCur      = deduped.map(([, i]) => i.orders.current);
      const ordersDyn      = deduped.map(([, i]) => i.orders.dynamics);
      const openCardCur    = deduped.map(([, i]) => i.openCard.current);
      const openCardDyn    = deduped.map(([, i]) => i.openCard.dynamics);
      const addToCartCur   = deduped.map(([, i]) => i.addToCart.current);
      const addToCartDyn   = deduped.map(([, i]) => i.addToCart.dynamics);
      const openToCartCur  = deduped.map(([, i]) => i.openToCart.current);
      const openToCartDyn  = deduped.map(([, i]) => i.openToCart.dynamics);

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

async function main() {
  if (!TOKEN) {
    console.error("WB_API_TOKEN is not set. Add it to .env or export it.");
    process.exitCode = 1;
    return;
  }

  const connStr = (process.env.DATABASE_URL ?? "").trim();
  if (!connStr) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const days = buildDayList();
  const client = new Client({ connectionString: connStr });
  await client.connect();
  console.log("Connected to PostgreSQL.");

  try {
    const nmIds = await loadNmIds(client);
    if (nmIds.length === 0) {
      console.error("No active/paused campaign products found in DB.");
      process.exitCode = 1;
      return;
    }

    const batches: number[][] = [];
    for (let i = 0; i < nmIds.length; i += BATCH_SIZE) {
      batches.push(nmIds.slice(i, i + BATCH_SIZE));
    }

    console.log(`\n=== WB JAM Daily Backfill ===`);
    console.log(`Days to fill: ${days[0]} → ${days[days.length - 1]} (${days.length} days)`);
    console.log(`Products: ${nmIds.length} | Batches per day: ${batches.length} | Interval: ${INTERVAL_MS}ms`);
    // 2 requests per batch (openCard + orders), each followed by an INTERVAL_MS pause.
    console.log(`Estimated time: ~${Math.ceil(days.length * batches.length * 2 * INTERVAL_MS / 60_000)} min\n`);

    const overallStart = Date.now();
    let daysSkipped = 0;
    let daysDone = 0;
    let daysEmpty = 0;

    for (const [dayIndex, day] of days.entries()) {
      // Resume: skip days that already have full data
      const existing = await countExistingSnapshots(client, day);
      if (existing >= nmIds.length * 0.9) {
        console.log(`[${dayIndex + 1}/${days.length}] ${day} — skipped (${existing} snapshots already in DB)`);
        daysSkipped++;
        continue;
      }

      console.log(`\n[${dayIndex + 1}/${days.length}] ${day} — fetching ${nmIds.length} products in ${batches.length} batches...`);

      let dayRows = 0;
      let dayNmIds = 0;
      let dayFailed = 0;
      let dayEmpty = 0;
      const dayStart = Date.now();

      for (const [batchIndex, batch] of batches.entries()) {
        process.stdout.write(`  batch ${batchIndex + 1}/${batches.length}...`);

        let items: SearchTextItem[];
        try {
          items = await fetchBatch(batch, day);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stdout.write(` FAILED: ${msg}\n`);
          dayFailed += batch.length;

          if (msg.includes("429")) {
            console.warn("  429 quota hit — waiting 65s before retrying...");
            await sleep(65_000);
            try {
              items = await fetchBatch(batch, day);
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
          const saved = await saveSnapshotForNmId(client, nmId, day, nmItems);
          batchRows += saved;
          dayNmIds++;
          if (nmItems.length === 0) dayEmpty++;
        }

        dayRows += batchRows;
        process.stdout.write(` ${batchRows} rows\n`);

        if (batchIndex < batches.length - 1) {
          await sleep(INTERVAL_MS);
        }
      }

      const elapsed = Math.round((Date.now() - dayStart) / 1000);
      const totalElapsed = Math.round((Date.now() - overallStart) / 60_000);

      if (dayRows === 0) {
        console.log(`  ✗ ${day} — WB returned no data (empty report, skipping). [${elapsed}s]`);
        daysEmpty++;
      } else {
        console.log(
          `  ✓ ${day} — ${dayNmIds} products, ${dayRows} rows` +
          (dayEmpty > 0 ? `, ${dayEmpty} products with 0 queries` : "") +
          (dayFailed > 0 ? `, ${dayFailed} failed` : "") +
          ` [${elapsed}s, total ${totalElapsed}min]`,
        );
        daysDone++;
      }

      // Pause between days to avoid consuming the per-minute quota immediately
      // on the first batch of the next day.
      if (dayIndex < days.length - 1) {
        await sleep(INTERVAL_MS);
      }
    }

    const totalMin = Math.round((Date.now() - overallStart) / 60_000);
    console.log(`\n=== Done ===`);
    console.log(`Filled: ${daysDone} days | Skipped (already in DB): ${daysSkipped} | Empty (WB no data): ${daysEmpty}`);
    console.log(`Total time: ${totalMin} min`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(msg);
  process.exitCode = 1;
});
