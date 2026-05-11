import { createDefaultProductAdvertisingSnapshotMeta } from "./product-advertising-sheet.response";
import type {
  ProductAdvertisingDailyStatsCoverageStatus,
  ProductAdvertisingQueryCoverageStatus,
} from "./types/product-advertising-sheet.types";
import type { RootCounts } from "./product-advertising-sheet.contract.shared";
import {
  asDailyStatsCoverageStatus,
  asDateOnly,
  asJamStatus,
  asNonEmptyStringOrNull,
  asNumber,
  asPeriodMetricsStatus,
  asQueryCoverageStatus,
  asSnapshotFit,
  asSnapshotSource,
  asSnapshotStatus,
  asIsoDateTime,
  isRecord,
  trackRepair,
} from "./product-advertising-sheet.contract.shared";

export function normalizeSnapshot(value: unknown, issues: string[]) {
  const fallback = createDefaultProductAdvertisingSnapshotMeta();
  if (!isRecord(value)) {
    issues.push("snapshot object is missing; defaults applied.");
    return fallback;
  }

  return {
    status: asSnapshotStatus(value.status) ?? trackRepair(issues, "snapshot.status", fallback.status),
    fit: asSnapshotFit(value.fit) ?? trackRepair(issues, "snapshot.fit", fallback.fit),
    source: asSnapshotSource(value.source) ?? trackRepair(issues, "snapshot.source", fallback.source),
    builtAt: asIsoDateTime(value.builtAt),
    requestedStartDate: asDateOnly(value.requestedStartDate),
    requestedEndDate: asDateOnly(value.requestedEndDate),
    snapshotStartDate: asDateOnly(value.snapshotStartDate),
    snapshotEndDate: asDateOnly(value.snapshotEndDate),
    builtFromExportRequestId: asNonEmptyStringOrNull(value.builtFromExportRequestId),
    lastError: asNonEmptyStringOrNull(value.lastError),
  };
}

export function normalizeRange(value: unknown, issues: string[]) {
  if (!isRecord(value)) {
    issues.push("range object is missing; defaults applied.");
    return {
      startDate: null,
      endDate: null,
      jamIncluded: false,
      jamStatus: "not_requested" as const,
    };
  }

  return {
    startDate: asDateOnly(value.startDate),
    endDate: asDateOnly(value.endDate),
    jamIncluded:
      typeof value.jamIncluded === "boolean"
        ? value.jamIncluded
        : trackRepair(issues, "range.jamIncluded", false),
    jamStatus: asJamStatus(value.jamStatus) ?? trackRepair(issues, "range.jamStatus", "not_requested"),
  };
}

export function normalizeSummary(
  value: unknown,
  counts: RootCounts,
  clustersCount: number,
  clusterQueriesCount: number,
  issues: string[],
) {
  const fallbackStatus: ProductAdvertisingQueryCoverageStatus =
    clustersCount === 0 ? "no-clusters" : clusterQueriesCount === 0 ? "missing-query-map" : "ready";

  if (!isRecord(value)) {
    issues.push("summary object is missing; counts recalculated.");
    return {
      ...counts,
      queryCoverageStatus: fallbackStatus,
      queryCoverageReason: null,
      dailyStatsCoverageStatus: "not_requested" as const,
      dailyStatsCoverageReason: null,
      dailyStatsWindowStartDate: null,
      dailyStatsWindowEndDate: null,
      periodMetricsStatus: "unavailable" as const,
      periodMetricsReason: null,
      periodMetricsActualStartDate: null,
      periodMetricsActualEndDate: null,
    };
  }

  const fallbackDailyStatsCoverageStatus: ProductAdvertisingDailyStatsCoverageStatus =
    asDailyStatsCoverageStatus(value.dailyStatsCoverageStatus) ??
    trackRepair(issues, "summary.dailyStatsCoverageStatus", "not_requested" as const);

  return {
    campaignsCount: asNumber(value.campaignsCount) ?? counts.campaignsCount,
    clustersCount: asNumber(value.clustersCount) ?? counts.clustersCount,
    clusterQueriesCount: asNumber(value.clusterQueriesCount) ?? counts.clusterQueriesCount,
    dailyStatsCount: asNumber(value.dailyStatsCount) ?? counts.dailyStatsCount,
    minusPhrasesCount: asNumber(value.minusPhrasesCount) ?? counts.minusPhrasesCount,
    keywordStatsCount: asNumber(value.keywordStatsCount) ?? counts.keywordStatsCount,
    queryCoverageStatus:
      asQueryCoverageStatus(value.queryCoverageStatus) ??
      trackRepair(issues, "summary.queryCoverageStatus", fallbackStatus),
    queryCoverageReason: asNonEmptyStringOrNull(value.queryCoverageReason),
    dailyStatsCoverageStatus: fallbackDailyStatsCoverageStatus,
    dailyStatsCoverageReason: asNonEmptyStringOrNull(value.dailyStatsCoverageReason),
    dailyStatsWindowStartDate: asDateOnly(value.dailyStatsWindowStartDate),
    dailyStatsWindowEndDate: asDateOnly(value.dailyStatsWindowEndDate),
    periodMetricsStatus:
      asPeriodMetricsStatus(value.periodMetricsStatus) ??
      trackRepair(
        issues,
        "summary.periodMetricsStatus",
        fallbackDailyStatsCoverageStatus === "full"
          ? ("exact" as const)
          : fallbackDailyStatsCoverageStatus === "partial"
            ? ("partial" as const)
            : ("unavailable" as const),
      ),
    periodMetricsReason:
      asNonEmptyStringOrNull(value.periodMetricsReason) ??
      asNonEmptyStringOrNull(value.dailyStatsCoverageReason),
    periodMetricsActualStartDate: asDateOnly(value.periodMetricsActualStartDate),
    periodMetricsActualEndDate: asDateOnly(value.periodMetricsActualEndDate),
  };
}
