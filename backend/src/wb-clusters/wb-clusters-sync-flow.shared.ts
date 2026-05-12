import { appEnv } from "../common/env";
import type { ClusterSyncPhase, PromotionCampaignDetailsItem } from "./wb-clusters.types";

type WbClustersService = any;
type ExtractedCampaignProduct = {
  nmId: number;
  subjectId: number | null;
  subjectName: string | null;
  searchBid: number | null;
};

export function getMonthlyFrequencyPeriod(self: WbClustersService) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);

  return {
    from: self.toIsoDate(start),
    to: self.toIsoDate(end),
    timezone: "Europe/Moscow",
  };
}

export async function updatePhaseCursorState(
  self: WbClustersService,
  phase: ClusterSyncPhase,
  advertId: number,
  syncRunId: string,
  updateGlobal: boolean,
) {
  await self.wbClustersRepository.updateSyncCursorState({
    stateKey: phase,
    lastCompletedAdvertId: advertId,
    lastSyncRunId: syncRunId,
  });
  if (updateGlobal) {
    await self.wbClustersRepository.updateSyncCursorState({
      lastCompletedAdvertId: advertId,
      lastSyncRunId: syncRunId,
    });
  }
}

export function maxDefinedNumber(self: WbClustersService, ...values: Array<number | null>) {
  const definedValues = values.filter((value): value is number => typeof value === "number");
  if (definedValues.length === 0) {
    return null;
  }

  return Math.max(...definedValues);
}

/**
 * Format a Date as YYYY-MM-DD using LOCAL time components.
 *
 * toISOString() always returns UTC, so on a Moscow-timezone server
 * (TZ=Europe/Moscow) midnight local = 21:00 UTC of the previous day,
 * which shifts every date string one day back. Using local getters
 * produces the correct calendar date that WB API expects.
 */
function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Regular stats sync period: yesterday + today (2 days).
 *
 * Historical data grows indefinitely in wb_cluster_daily_stats — each day
 * is written once and never deleted. The regular 10-minute sync only needs
 * to refresh the most recent two days:
 *   - today:     intraday accumulation (WB aggregates throughout the day)
 *   - yesterday: final finalization pass (after WB closes the previous day)
 *
 * For initial historical backfill use getStatsBackfillPeriod().
 */
export function getStatsPeriod(_self: WbClustersService) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

  return {
    from: toLocalDateStr(yesterday),
    to: toLocalDateStr(today),
  };
}

/**
 * Full historical backfill period: last 30 days.
 * Used for first-time seeding or manual re-sync of history.
 */
export function getStatsBackfillPeriod(_self: WbClustersService) {
  const today = new Date();

  // Target: same calendar day one month back (e.g. May 12 → April 12).
  // WB stats API enforces a strict 30-day inclusive limit.
  const lastDayOfPrevMonth = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  const startDay = Math.min(today.getDate(), lastDayOfPrevMonth);
  const prevMonth = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
  const prevYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
  const calendarMonthStart = new Date(prevYear, prevMonth, startDay);

  // Cap: ensure the range is at most 30 days inclusive (≤ 29-day span).
  const maxSpanDays = 29;
  const spanDays = Math.round((today.getTime() - calendarMonthStart.getTime()) / 86_400_000);
  const start =
    spanDays > maxSpanDays
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - maxSpanDays)
      : calendarMonthStart;

  return {
    from: toLocalDateStr(start),
    to: toLocalDateStr(today),
  };
}

export function toIsoDate(self: WbClustersService, date: Date) {
  return date.toISOString().slice(0, 10);
}

export function chunkArray<T>(self: WbClustersService, items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

export function extractProductsFromDetail(
  self: WbClustersService,
  detail: PromotionCampaignDetailsItem,
): ExtractedCampaignProduct[] {
  return (detail.nm_settings ?? [])
    .map((item) => ({
      nmId: item.nm_id,
      subjectId: typeof item.subject?.id === "number" ? item.subject.id : null,
      subjectName:
        typeof item.subject?.name === "string" && item.subject.name.trim()
          ? item.subject.name.trim()
          : null,
      searchBid: self.normalizeSearchBidFromWb(item.bids_kopecks?.search),
    }))
    .filter((item) => Number.isFinite(item.nmId));
}

export function activateManualBidInteractiveWindow(
  self: WbClustersService,
  reason: string,
  durationMs: number,
) {
  const safeDurationMs = Math.max(0, Math.trunc(durationMs));
  if (safeDurationMs <= 0) {
    return;
  }

  const nextUntilMs = Date.now() + safeDurationMs;
  self.manualBidInteractiveUntilMs = Math.max(self.manualBidInteractiveUntilMs, nextUntilMs);
  self.wbPromotionApiClient.prioritizeBidWrites(safeDurationMs);
  self.logger.log(
    `Manual bid interactive window extended by ${safeDurationMs} ms after ${reason}.`,
  );
}

export function isManualBidInteractiveWindowActive(self: WbClustersService) {
  return self.manualBidInteractiveUntilMs > Date.now();
}

export function getManualBidInteractiveRemainingMs(self: WbClustersService) {
  return Math.max(0, self.manualBidInteractiveUntilMs - Date.now());
}
