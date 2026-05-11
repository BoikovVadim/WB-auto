import type {
  ProductAdvertisingSheetResponse,
  ProductClusterLookupResponse,
} from "./syncClientTypes";
import {
  isIsoDateString,
  isNullableDateOnlyString,
  isNullableIsoDateString,
  isNullableNonEmptyString,
  isRecord,
} from "./syncClientValidatorUtils";
import {
  isProductAdvertisingCampaign,
  isProductAdvertisingCluster,
  isProductAdvertisingClusterQuery,
  isProductAdvertisingDailyStatsCoverageStatus,
  isProductAdvertisingJamMaterializationStatus,
  isProductAdvertisingDailyStat,
  isProductAdvertisingKeywordStat,
  isProductAdvertisingMinusPhrase,
  isProductAdvertisingPeriodMetricsStatus,
  isProductAdvertisingQueryCoverageStatus,
  isProductAdvertisingSnapshotFit,
  isProductAdvertisingSnapshotSource,
  isProductAdvertisingSnapshotStatus,
  isProductClusterLookupMatch,
} from "./syncClientAdvertisingValidatorGuards";

export function assertProductClusterLookupResponse(
  value: unknown,
): asserts value is ProductClusterLookupResponse {
  if (
    !isRecord(value) ||
    typeof value.nmId !== "number" ||
    !isIsoDateString(value.checkedAt) ||
    !Array.isArray(value.matches) ||
    value.matches.some((item) => !isProductClusterLookupMatch(item))
  ) {
    throw new Error("Invalid product cluster lookup response.");
  }
}

export function assertProductAdvertisingSheetResponse(
  value: unknown,
): asserts value is ProductAdvertisingSheetResponse {
  if (
    !isRecord(value) ||
    typeof value.nmId !== "number" ||
    !isIsoDateString(value.checkedAt) ||
    !isRecord(value.snapshot) ||
    !isProductAdvertisingSnapshotStatus(value.snapshot.status) ||
    !isProductAdvertisingSnapshotFit(value.snapshot.fit) ||
    !isProductAdvertisingSnapshotSource(value.snapshot.source) ||
    !isNullableIsoDateString(value.snapshot.builtAt) ||
    !isNullableDateOnlyString(value.snapshot.requestedStartDate) ||
    !isNullableDateOnlyString(value.snapshot.requestedEndDate) ||
    !isNullableDateOnlyString(value.snapshot.snapshotStartDate) ||
    !isNullableDateOnlyString(value.snapshot.snapshotEndDate) ||
    !isNullableNonEmptyString(value.snapshot.builtFromExportRequestId) ||
    !isNullableNonEmptyString(value.snapshot.lastError) ||
    !isRecord(value.range) ||
    !isNullableDateOnlyString(value.range.startDate) ||
    !isNullableDateOnlyString(value.range.endDate) ||
    typeof value.range.jamIncluded !== "boolean" ||
    !isProductAdvertisingJamMaterializationStatus(value.range.jamStatus) ||
    !isRecord(value.summary) ||
    typeof value.summary.campaignsCount !== "number" ||
    typeof value.summary.clustersCount !== "number" ||
    typeof value.summary.clusterQueriesCount !== "number" ||
    typeof value.summary.dailyStatsCount !== "number" ||
    typeof value.summary.minusPhrasesCount !== "number" ||
    typeof value.summary.keywordStatsCount !== "number" ||
    !isProductAdvertisingQueryCoverageStatus(value.summary.queryCoverageStatus) ||
    !isNullableNonEmptyString(value.summary.queryCoverageReason) ||
    !isProductAdvertisingDailyStatsCoverageStatus(value.summary.dailyStatsCoverageStatus) ||
    !isNullableNonEmptyString(value.summary.dailyStatsCoverageReason) ||
    !isNullableDateOnlyString(value.summary.dailyStatsWindowStartDate) ||
    !isNullableDateOnlyString(value.summary.dailyStatsWindowEndDate) ||
    !isProductAdvertisingPeriodMetricsStatus(value.summary.periodMetricsStatus) ||
    !isNullableNonEmptyString(value.summary.periodMetricsReason) ||
    !isNullableDateOnlyString(value.summary.periodMetricsActualStartDate) ||
    !isNullableDateOnlyString(value.summary.periodMetricsActualEndDate) ||
    !Array.isArray(value.campaigns) ||
    value.campaigns.some((item) => !isProductAdvertisingCampaign(item)) ||
    !Array.isArray(value.clusters) ||
    value.clusters.some((item) => !isProductAdvertisingCluster(item)) ||
    !Array.isArray(value.clusterQueries) ||
    value.clusterQueries.some((item) => !isProductAdvertisingClusterQuery(item)) ||
    !Array.isArray(value.dailyStats) ||
    value.dailyStats.some((item) => !isProductAdvertisingDailyStat(item)) ||
    !Array.isArray(value.minusPhrases) ||
    value.minusPhrases.some((item) => !isProductAdvertisingMinusPhrase(item)) ||
    !Array.isArray(value.keywordStats) ||
    value.keywordStats.some((item) => !isProductAdvertisingKeywordStat(item))
  ) {
    throw new Error("Invalid product advertising sheet response.");
  }
}
