import { loadProductSearchTextsRangeByNmId } from "../wb-sync/product-search-texts-range";

type WbClustersService = any;

/**
 * JAM sync strategy — per-day snapshots:
 *
 * 1. Always download TODAY for every nmId (keeps today's data fresh every 6 h).
 * 2. Discover all calendar days in the last JAM_LOOKBACK_DAYS window that have
 *    no per-day snapshot yet and download them sequentially per product.
 *    → On the very first run this becomes a full historical backfill.
 *    → On subsequent runs only today (and any new gaps) are downloaded.
 *
 * The read path aggregates these 1-day snapshots with SUM on demand, so any
 * arbitrary date range is served instantly from the DB without a live WB call
 * once the backfill window is covered.
 *
 * Data is never deleted; the DB grows as history accumulates.
 */
export async function runJamSyncPhase(
  self: WbClustersService,
  nmIds: number[],
  warningMessages: string[],
): Promise<{ nmIdsRefreshed: number }> {
  const uniqueNmIds = Array.from(new Set(nmIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueNmIds.length === 0) {
    return { nmIdsRefreshed: 0 };
  }

  const today = getTodayDateStr(self);
  let nmIdsRefreshed = 0;

  const concurrency = 3;
  for (let i = 0; i < uniqueNmIds.length; i += concurrency) {
    const batch = uniqueNmIds.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (nmId) => {
        let refreshed = false;

        try {
          // Refresh today's snapshot (data changes throughout the day).
          // Skip if already attempted within the last 65 minutes to avoid
          // extending WB's rate-limit cooldown on the same combination.
          const todayAttempted = await self.wbClustersRepository.wasJamAttemptedRecently(nmId, today);
          if (!todayAttempted) {
            const todayResult = await syncOneDayJam(self, nmId, today, warningMessages);
            if (todayResult) refreshed = true;
          }

          // Fill historical gaps: up to MAX_DATES_PER_PRODUCT_PER_RUN missing days,
          // newest first.  This distributes the WB rate-limit budget across all products
          // instead of exhausting it on one product's full 30-day history.
          const missingDates = await self.wbClustersRepository.findMissingDailyJamDates({
            nmId,
            lookbackDays: JAM_LOOKBACK_DAYS,
            maxPerProduct: MAX_DATES_PER_PRODUCT_PER_RUN,
          });

          for (const date of missingDates) {
            const backfillResult = await syncOneDayJam(self, nmId, date, warningMessages);
            if (backfillResult) refreshed = true;
          }
        } catch (err) {
          // DB connection pool exhaustion or network errors must not abort the
          // entire run — log and continue with the next product.
          const msg = err instanceof Error ? err.message : String(err);
          warningMessages.push(`JAM nm ${nmId}: skipped due to transient error: ${msg}`);
        }

        if (refreshed) nmIdsRefreshed++;
      }),
    );
  }

  return { nmIdsRefreshed };
}

/** How many calendar days of history we maintain per product. */
const JAM_LOOKBACK_DAYS = 30;

/**
 * Maximum number of historical dates to attempt per product per sync run.
 * Set to JAM_LOOKBACK_DAYS so every run covers the full 30-day window.
 * Newest dates are tried first (ORDER BY day DESC in findMissingDailyJamDates).
 * The separate JAM rate limiter (WB_JAM_MIN_INTERVAL_MS ≈ 6 s → 600 req/hr) keeps
 * us safely below WB's ~700/hr account-wide quota, so there is no need to
 * artificially cap per-product dates to spread the budget.
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
