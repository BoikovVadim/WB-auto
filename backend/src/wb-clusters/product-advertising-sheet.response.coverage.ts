import type {
  ProductAdvertisingDailyStatsCoverageStatus,
  ProductAdvertisingPeriodMetricsStatus,
  ProductAdvertisingSheetResponse,
  ProductAdvertisingSnapshotFit,
  ProductAdvertisingSnapshotSource,
  ProductAdvertisingSnapshotStatus,
} from "./types/product-advertising-sheet.types";

import { normalizeRequestedRangeBounds, getDailyStatsDateBounds, formatDay } from "./product-advertising-sheet.response.dates";
import { createDefaultProductAdvertisingSnapshotMeta } from "./product-advertising-sheet.response.snapshot";

function resolveProductAdvertisingDailyStatsCoverage(
  requestedBounds: ReturnType<typeof normalizeRequestedRangeBounds>,
  availableBounds: ReturnType<typeof getDailyStatsDateBounds>,
): {
  status: ProductAdvertisingDailyStatsCoverageStatus;
  reason: string | null;
  windowStartDate: string | null;
  windowEndDate: string | null;
} {
  if (!requestedBounds) {
    return {
      status: "not_requested",
      reason: null,
      windowStartDate: availableBounds?.startDate ?? null,
      windowEndDate: availableBounds?.endDate ?? null,
    };
  }

  if (!availableBounds) {
    return {
      status: "missing",
      reason: "No daily stats rows are available for the requested date range.",
      windowStartDate: null,
      windowEndDate: null,
    };
  }

  if (availableBounds.endTime < requestedBounds.startTime) {
    return {
      status: "missing",
      reason: `Daily stats are only available through ${availableBounds.endDate}, which is older than the requested range.`,
      windowStartDate: availableBounds.startDate,
      windowEndDate: availableBounds.endDate,
    };
  }

  if (availableBounds.startTime > requestedBounds.endTime) {
    return {
      status: "missing",
      reason: `Daily stats start at ${availableBounds.startDate}, which is after the requested range.`,
      windowStartDate: availableBounds.startDate,
      windowEndDate: availableBounds.endDate,
    };
  }

  const hasFullCoverage =
    availableBounds.startTime <= requestedBounds.startTime &&
    availableBounds.endTime >= requestedBounds.endTime;
  if (hasFullCoverage) {
    return {
      status: "full",
      reason: null,
      windowStartDate: availableBounds.startDate,
      windowEndDate: availableBounds.endDate,
    };
  }

  return {
    status: "partial",
    reason:
      `Daily stats cover only ${availableBounds.startDate}..${availableBounds.endDate} ` +
      `for the requested ${requestedBounds.startDate}..${requestedBounds.endDate} range.`,
    windowStartDate: availableBounds.startDate,
    windowEndDate: availableBounds.endDate,
  };
}

function resolveProductAdvertisingPeriodMetricsMeta(
  coverage: ReturnType<typeof resolveProductAdvertisingDailyStatsCoverage>,
  requestedBounds: ReturnType<typeof normalizeRequestedRangeBounds>,
  availableBounds: ReturnType<typeof getDailyStatsDateBounds>,
): {
  status: ProductAdvertisingPeriodMetricsStatus;
  reason: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
} {
  if (!requestedBounds) {
    return {
      status: "unavailable",
      reason: null,
      actualStartDate: null,
      actualEndDate: null,
    };
  }

  if (coverage.status === "full") {
    return {
      status: "exact",
      reason: null,
      actualStartDate: requestedBounds.startDate,
      actualEndDate: requestedBounds.endDate,
    };
  }

  if (coverage.status === "partial" && availableBounds) {
    return {
      status: "partial",
      reason: coverage.reason,
      actualStartDate: formatDay(
        Math.max(requestedBounds.startTime, availableBounds.startTime),
      ),
      actualEndDate: formatDay(
        Math.min(requestedBounds.endTime, availableBounds.endTime),
      ),
    };
  }

  return {
    status: "unavailable",
    reason: coverage.reason,
    actualStartDate: null,
    actualEndDate: null,
  };
}

function stripNonExactProductAdvertisingPeriodMetrics(
  sheet: ProductAdvertisingSheetResponse,
): ProductAdvertisingSheetResponse {
  return {
    ...sheet,
    clusters: sheet.clusters.map((cluster) => ({
      ...cluster,
      views: null,
      clicks: null,
      orders: null,
      addToCart: null,
      shks: null,
      ctr: null,
      avgPosition: null,
      cpc: null,
      cpm: null,
      spend: null,
    })),
    clusterQueries: sheet.clusterQueries.map((query) => ({
      ...query,
      views: null,
      clicks: null,
      orders: null,
      addToCart: null,
      shks: null,
    })),
  };
}

export function withProductAdvertisingDailyStatsCoverageMeta(
  sheet: ProductAdvertisingSheetResponse,
  requestedRange?: {
    startDate: string | null;
    endDate: string | null;
  } | null,
): ProductAdvertisingSheetResponse {
  const normalizedRequestedRange = requestedRange ?? {
    startDate: sheet.range.startDate,
    endDate: sheet.range.endDate,
  };
  const requestedBounds = normalizeRequestedRangeBounds(
    normalizedRequestedRange.startDate,
    normalizedRequestedRange.endDate,
  );
  const availableBounds = getDailyStatsDateBounds(sheet.dailyStats);
  const coverage = resolveProductAdvertisingDailyStatsCoverage(requestedBounds, availableBounds);
  const periodMetrics = resolveProductAdvertisingPeriodMetricsMeta(
    coverage,
    requestedBounds,
    availableBounds,
  );
  const metricsSanitizedSheet =
    periodMetrics.status === "exact" || periodMetrics.status === "partial"
      ? sheet
      : stripNonExactProductAdvertisingPeriodMetrics(sheet);

  return {
    ...metricsSanitizedSheet,
    summary: {
      ...metricsSanitizedSheet.summary,
      dailyStatsCoverageStatus: coverage.status,
      dailyStatsCoverageReason: coverage.reason,
      dailyStatsWindowStartDate: coverage.windowStartDate,
      dailyStatsWindowEndDate: coverage.windowEndDate,
      periodMetricsStatus: periodMetrics.status,
      periodMetricsReason: periodMetrics.reason,
      periodMetricsActualStartDate: periodMetrics.actualStartDate,
      periodMetricsActualEndDate: periodMetrics.actualEndDate,
    },
  };
}

export function createEmptyProductAdvertisingSheetResponse(input: {
  nmId: number;
  requestedStartDate?: string | null;
  requestedEndDate?: string | null;
  snapshotStatus?: ProductAdvertisingSnapshotStatus;
  snapshotFit?: ProductAdvertisingSnapshotFit;
  snapshotSource?: ProductAdvertisingSnapshotSource;
  lastError?: string | null;
}): ProductAdvertisingSheetResponse {
  return withProductAdvertisingDailyStatsCoverageMeta({
    nmId: input.nmId,
    checkedAt: new Date().toISOString(),
    snapshot: {
      ...createDefaultProductAdvertisingSnapshotMeta({
        requestedStartDate: input.requestedStartDate,
        requestedEndDate: input.requestedEndDate,
      }),
      status: input.snapshotStatus ?? "missing",
      fit: input.snapshotFit ?? "unavailable",
      source: input.snapshotSource ?? "snapshot_store",
      lastError: input.lastError ?? null,
    },
    range: {
      startDate: input.requestedStartDate ?? null,
      endDate: input.requestedEndDate ?? null,
      jamIncluded: false,
      jamStatus: "not_requested",
    },
    summary: {
      campaignsCount: 0,
      clustersCount: 0,
      clusterQueriesCount: 0,
      dailyStatsCount: 0,
      minusPhrasesCount: 0,
      keywordStatsCount: 0,
      queryCoverageStatus: "no-clusters",
      queryCoverageReason: null,
      dailyStatsCoverageStatus: "not_requested",
      dailyStatsCoverageReason: null,
      dailyStatsWindowStartDate: null,
      dailyStatsWindowEndDate: null,
      periodMetricsStatus: "unavailable",
      periodMetricsReason: null,
      periodMetricsActualStartDate: null,
      periodMetricsActualEndDate: null,
    },
    campaigns: [],
    clusters: [],
    clusterQueries: [],
    dailyStats: [],
    minusPhrases: [],
    keywordStats: [],
  });
}

