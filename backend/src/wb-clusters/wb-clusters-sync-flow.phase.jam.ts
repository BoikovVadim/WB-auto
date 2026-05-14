import { loadProductSearchTextsRangeByNmId } from "../wb-sync/product-search-texts-range";

type WbClustersService = any;

/**
 * JAM sync strategy — per-day snapshots, two tracks:
 *
 * CONTINUOUS TODAY-LOOP  (runJamTodayLoop, started once at module init):
 *   - Runs forever in background; no cooldown gate — the rate limiter
 *     (WB_JAM_MIN_INTERVAL_MS = 6 s) is the only throttle.
 *   - Active-RK products (status 4/9) are always first in each cycle.
 *   - Cycle time = N products × 2 requests × 6 s ≈ 86 min for 371 products.
 *     That exceeds the 65-minute WB cooldown, so by the time we loop back
 *     to product #1 it is always eligible again — no explicit wait needed.
 *   - Two requests per product per date: topOrderBy "openCard" + "orders".
 *     Results are merged and deduplicated before storage.
 *   - IMPORTANT: "today" snapshots are INTRADAY — partial data until midnight.
 *
 * NIGHTLY CRON  (handleScheduledJamSync, 01:00 MSK), two steps:
 *   Step 1 — runJamFinalizeYesterday:
 *     Force-refreshes yesterday for ALL products, unconditionally overwriting
 *     any intraday snapshot saved by the today-loop.  After midnight the data
 *     for the previous calendar day is fully finalized on WB's side.
 *   Step 2 — gap-fill via findMissingDailyJamDates:
 *     Fills any dates in the 30-day lookback window that have NO snapshot yet.
 *
 * Per-day snapshots are NEVER deleted — data accumulates indefinitely for
 * any-range historical analysis (last week, last month, last year, etc.).
 */
export async function runJamSyncPhase(
  self: WbClustersService,
  nmIds: number[],
  warningMessages: string[],
  options?: { todayOnly?: boolean },
): Promise<{ nmIdsRefreshed: number }> {
  const uniqueNmIds = Array.from(new Set(nmIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueNmIds.length === 0) {
    return { nmIdsRefreshed: 0 };
  }

  const todayOnly = options?.todayOnly ?? false;
  const today = getTodayDateStr(self);
  let nmIdsRefreshed = 0;

  const concurrency = 3;
  for (let i = 0; i < uniqueNmIds.length; i += concurrency) {
    const batch = uniqueNmIds.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (nmId) => {
        let refreshed = false;

        try {
          if (todayOnly) {
            // Lightweight path used by the 10-minute advertising sync.
            // Only fetches today — WB cooldown (65 min) prevents over-calling.
            const todayAttempted = await self.wbClustersRepository.wasJamAttemptedRecently(nmId, today);
            if (!todayAttempted) {
              const result = await syncOneDayJam(self, nmId, today, warningMessages);
              if (result) refreshed = true;
            }
          } else {
            // Nightly path: finalize yesterday + fill any recent gaps.
            // Skip today — it is already covered by the 65-70 min embedded pass.
            const missingDates = await self.wbClustersRepository.findMissingDailyJamDates({
              nmId,
              lookbackDays: JAM_LOOKBACK_DAYS,
              maxPerProduct: MAX_DATES_PER_PRODUCT_PER_RUN,
            });

            for (const date of missingDates) {
              const result = await syncOneDayJam(self, nmId, date, warningMessages);
              if (result) refreshed = true;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warningMessages.push(`JAM nm ${nmId}: skipped due to transient error: ${msg}`);
        }

        if (refreshed) nmIdsRefreshed++;
      }),
    );
  }

  return { nmIdsRefreshed };
}

/**
 * WB enforces a hard 30-day limit on /api/v2/search-report/product/search-texts.
 * Per-day snapshots stored in DB are kept forever so historical analysis
 * across any date range is possible once each day has been fetched.
 */
const JAM_LOOKBACK_DAYS = 30;

/**
 * Gap-fill dates attempted per product per nightly run.
 * Newest dates first — yesterday is always the top priority.
 */
const MAX_DATES_PER_PRODUCT_PER_RUN = JAM_LOOKBACK_DAYS;

async function syncOneDayJam(
  self: WbClustersService,
  nmId: number,
  date: string,
  warningMessages: string[],
): Promise<boolean> {
  const period = self.normalizeAdvertisingSheetJamRange(date, date);

  // Log the attempt BEFORE the API call so the timestamp reflects when WB's
  // rate-limit cooldown starts, preventing retries within the 65-minute window.
  await self.wbClustersRepository.logJamAttempt(nmId, date);

  const result = await self.tryApiStep(
    `Jam search-texts nm ${nmId} (${date})`,
    async () => {
      const rows = await loadProductSearchTextsRangeByNmId({
        nmId,
        currentPeriod: period,
        request: (body: Record<string, unknown>) =>
          self.wbApiClient.requestJam({
            method: "POST",
            path: "/api/v2/search-report/product/search-texts",
            retryAttempts: 0,
            body,
          }),
        preferredTopOrderBy: "openCard",
        topOrderByCount: 2,
        limit: 30,
      });

      const deduplicatedRows = self.deduplicateProductAdvertisingSearchTexts(rows);
      await self.wbClustersRepository.replaceStoredProductSearchTextRange({
        nmId,
        startDate: period.start,
        endDate: period.end,
        rows: deduplicatedRows,
      });

      // Clear only the JAM overlay cache so the next sheet read serves fresh
      // search-text data. We intentionally avoid a full invalidation (which
      // would bump cacheVersion and force querySearchIndex rebuilds on every
      // cluster table request while the backfill is running).
      self.clearJamSearchTextCacheForNmId(nmId);

      return nmId;
    },
    warningMessages,
  );

  return result !== null;
}

function getTodayDateStr(self: WbClustersService): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return self.formatAdvertisingSheetDate(today);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getYesterdayDateStr(self: WbClustersService): string {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return self.formatAdvertisingSheetDate(yesterday);
}

/**
 * Finalizes yesterday's JAM snapshots for all given products.
 *
 * Problem this solves:
 *   The today-loop saves intraday snapshots for the current calendar day.
 *   When midnight passes, those snapshots become "yesterday" and are treated
 *   as complete by findMissingDailyJamDates (which skips dates that already
 *   have ANY snapshot).  Without this step, yesterday's data would forever
 *   reflect the last intraday update (e.g., 23:30 MSK) rather than the
 *   fully finalized WB numbers for the whole day.
 *
 * This function is called FIRST by the nightly cron (01:00 MSK), before the
 * gap-fill pass.  It unconditionally calls syncOneDayJam for yesterday which
 * does an UPSERT — existing partial snapshots are replaced with the finalized
 * full-day data from WB.
 *
 * Rate: 371 products × 2 requests × 6 s ≈ 44 minutes — well within the
 * nightly window.  Progress is logged every 50 products.
 */
export async function runJamFinalizeYesterday(
  self: WbClustersService,
  nmIds: number[],
  warningMessages: string[],
): Promise<{ finalized: number }> {
  const uniqueNmIds = Array.from(new Set(nmIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueNmIds.length === 0) {
    return { finalized: 0 };
  }

  const yesterday = getYesterdayDateStr(self);
  self.logger.log(
    `JAM finalize-yesterday: re-fetching ${yesterday} for ${uniqueNmIds.length} products.`,
  );

  let finalized = 0;
  for (let i = 0; i < uniqueNmIds.length; i++) {
    const nmId = uniqueNmIds[i];
    try {
      const synced = await syncOneDayJam(self, nmId, yesterday, warningMessages);
      if (synced) finalized++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warningMessages.push(`JAM finalize-yesterday nm ${nmId}: ${msg}`);
    }

    if ((i + 1) % 50 === 0) {
      self.logger.log(
        `JAM finalize-yesterday: ${i + 1}/${uniqueNmIds.length} done, ${finalized} finalized so far.`,
      );
    }
  }

  self.logger.log(
    `JAM finalize-yesterday: done. Finalized ${finalized}/${uniqueNmIds.length} products for ${yesterday}.`,
  );
  return { finalized };
}

/**
 * Continuous JAM today-loop.
 *
 * Fetches today's JAM data (2 WB requests: openCard + orders) for every known
 * product in a round-robin fashion, forever.  Active-RK products (WB campaign
 * status 4/9) are always placed first so their data is the freshest.
 *
 * Rate is naturally bounded by WB_JAM_MIN_INTERVAL_MS (default 6 s):
 *   431 products × 2 requests × 6 s ≈ 86 min per full cycle.
 * WB's per-product cooldown is 65 min — the cycle duration exceeds it, so we
 * never need an explicit cooldown check here.
 *
 * Call once from onModuleInit; pass a shared signal object so the loop can be
 * stopped cleanly during module teardown.
 */
export async function runJamTodayLoop(
  self: WbClustersService,
  signal: { stopped: boolean },
): Promise<void> {
  // Give DB, schema-init, and the warmup queue time to settle before we start
  // hammering WB with JAM requests.
  await delay(5 * 60 * 1000);

  self.logger.log("JAM today-loop: starting continuous cycle.");
  let cycleCount = 0;

  while (!signal.stopped) {
    try {
      const [activeNmIds, allNmIds] = await Promise.all([
        self.wbClustersRepository.getActiveAdvertisingNmIds(),
        self.wbClustersRepository.getAllKnownNmIds(),
      ]);

      if (allNmIds.length === 0) {
        // No products yet — wait before polling again.
        await delay(60_000);
        continue;
      }

      // Active-RK products first, then the rest in stable order.
      const activeSet = new Set(activeNmIds);
      const passiveNmIds = (allNmIds as number[]).filter((id) => !activeSet.has(id));
      const orderedNmIds = [...activeNmIds, ...passiveNmIds];

      cycleCount++;
      const today = getTodayDateStr(self);
      const warnings: string[] = [];

      self.logger.log(
        `JAM today-loop #${cycleCount}: fetching ${today} for ${orderedNmIds.length} products ` +
        `(${activeNmIds.length} active RK first, ${passiveNmIds.length} others).`,
      );

      for (const nmId of orderedNmIds) {
        if (signal.stopped) break;
        try {
          await syncOneDayJam(self, nmId, today, warnings);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`JAM today nm ${nmId}: ${msg}`);
        }
      }

      if (warnings.length > 0) {
        self.logger.warn(
          `JAM today-loop #${cycleCount}: done with ${warnings.length} warnings: ` +
          warnings.slice(0, 5).join("; "),
        );
      } else {
        self.logger.log(
          `JAM today-loop #${cycleCount}: done for ${orderedNmIds.length} products.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      self.logger.error(`JAM today-loop: unhandled cycle error: ${msg}`);
      // Brief pause before retrying so a persistent error doesn't spin at 100 % CPU.
      await delay(60_000);
    }
    // No explicit inter-cycle wait — the WB_JAM_MIN_INTERVAL_MS throttle inside
    // requestJam keeps us well within WB's 700 req/hr quota.
  }

  self.logger.log("JAM today-loop: stopped.");
}

/**
 * Generates all calendar dates in [today - lookbackDays .. yesterday], oldest first.
 * Today is excluded — it is always intraday and is handled by the today-loop.
 */
function generateAllLookbackDates(self: WbClustersService, lookbackDays: number): string[] {
  const dates: string[] = [];
  for (let daysAgo = lookbackDays; daysAgo >= 1; daysAgo--) {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
    dates.push(self.formatAdvertisingSheetDate(d));
  }
  return dates;
}

/**
 * One-time JAM backfill loop — ALWAYS-OVERWRITE mode.
 *
 * Strategy: active-RK products first (A→Z by vendor code), then all others (A→Z).
 * For each product, ALL 30 calendar days are (re-)fetched before moving on.
 * Existing snapshots are unconditionally overwritten via UPSERT so any intraday
 * partial data accumulated by the today-loop is replaced with finalized data.
 *
 * Why always overwrite?
 *   The today-loop saves intraday snapshots throughout the day.  When those days
 *   become historical, findMissingDailyJamDates would skip them (snapshot exists).
 *   Without a forced refresh, partial data from e.g. 14:00 would stay forever.
 *   By re-fetching every date unconditionally we guarantee every historical day
 *   contains the fully finalized WB numbers.
 *
 * Stop: the loop exits after ONE complete pass (all products × all dates done).
 * Ongoing freshness is maintained by:
 *   • today-loop — keeps the current day current
 *   • nightly finalize-yesterday — finalizes the previous day at 01:00 MSK
 *   • nightly gap-fill — fills any date that still has no snapshot at all
 *
 * Rate: bounded by WB_JAM_MIN_INTERVAL_MS (6 s).  Serial queue — throughput
 * never exceeds 600 req/hr (WB quota is 700 req/hr for this endpoint).
 */
export async function runJamBackfillLoop(
  self: WbClustersService,
  signal: { stopped: boolean },
): Promise<void> {
  // Give DB, schema-init, and the warmup queue time to settle before starting.
  await delay(5 * 60 * 1000);

  const orderedNmIds = await self.wbClustersRepository.getJamBackfillQueue();
  if (orderedNmIds.length === 0) {
    self.logger.log("JAM backfill-loop: no products found, exiting.");
    return;
  }

  const allDates = generateAllLookbackDates(self, JAM_LOOKBACK_DAYS);

  self.logger.log(
    `JAM backfill-loop: starting full-overwrite pass for ${orderedNmIds.length} products × ` +
    `${allDates.length} dates (${allDates[0]} → ${allDates[allDates.length - 1]}).`,
  );

  let totalDatesSynced = 0;
  let totalWarnings = 0;

  for (let i = 0; i < orderedNmIds.length; i++) {
    if (signal.stopped) break;

    const nmId = orderedNmIds[i];
    const productWarnings: string[] = [];
    let productSynced = 0;

    for (const date of allDates) {
      if (signal.stopped) break;
      try {
        const synced = await syncOneDayJam(self, nmId, date, productWarnings);
        if (synced) {
          productSynced++;
          totalDatesSynced++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        productWarnings.push(`${date}: ${msg}`);
      }
    }

    totalWarnings += productWarnings.length;

    // Log progress every 10 products
    if ((i + 1) % 10 === 0 || i + 1 === orderedNmIds.length) {
      self.logger.log(
        `JAM backfill-loop: ${i + 1}/${orderedNmIds.length} products done. ` +
        `Total dates synced: ${totalDatesSynced}. Warnings: ${totalWarnings}.`,
      );
    }
  }

  self.logger.log(
    `JAM backfill-loop: full-overwrite pass complete. ` +
    `${totalDatesSynced} dates synced across ${orderedNmIds.length} products. ` +
    `${totalWarnings} warnings total. ` +
    `Ongoing freshness handled by today-loop + nightly cron.`,
  );
}
