import type {
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingWorkspaceClusterSortKey,
  ProductAdvertisingWorkspaceClusterTableResponse,
  ProductAdvertisingWorkspaceResponse,
} from "./syncClientTypes";
import {
  isNonEmptyString,
  isNullableDateOnlyString,
  isNullableIsoDateString,
  isNullableNonEmptyString,
  isNullableNumber,
  isRecord,
} from "./syncClientValidatorUtils";
import {
  isProductAdvertisingActionSyncStatus,
  isProductAdvertisingBidSyncStatus,
  isProductAdvertisingPeriodMetricsStatus,
  isProductAdvertisingQueryCoverageStatus,
  isProductAdvertisingSourceKind,
} from "./syncClientAdvertisingCoreValidatorGuards";

export function isProductAdvertisingWorkspaceCampaignTab(
  value: unknown,
): value is ProductAdvertisingWorkspaceResponse["campaignTabs"][number] {
  return (
    isRecord(value) &&
    typeof value.advertId === "number" &&
    isNullableNonEmptyString(value.campaignName) &&
    isNullableNumber(value.campaignType) &&
    isNullableNumber(value.campaignStatus) &&
    isNullableNonEmptyString(value.paymentType) &&
    isNullableNonEmptyString(value.bidType) &&
    isNullableNonEmptyString(value.currency) &&
    isNullableIsoDateString(value.syncedAt) &&
    typeof value.rowsCount === "number" &&
    isRecord(value.totals) &&
    isNullableNumber(value.totals.spend) &&
    isNullableNumber(value.totals.orders) &&
    isNullableNumber(value.totals.clicks) &&
    isNullableNumber(value.totals.views) &&
    isNullableNumber(value.totals.addToCart) &&
    isNullableNumber(value.totals.ctr) &&
    isNullableNumber(value.totals.ctc) &&
    isNullableNumber(value.totals.cto) &&
    isNullableNumber(value.totals.cpc) &&
    isNullableNumber(value.totals.cpm) &&
    isNullableNumber(value.totals.cpo) &&
    isNullableNumber(value.totals.viewToOrder) &&
    typeof value.totals.activeCount === "number" &&
    typeof value.totals.excludedCount === "number"
  );
}

export function isProductAdvertisingWorkspaceReadiness(
  value: unknown,
): value is ProductAdvertisingWorkspaceResponse["readiness"] {
  return (
    isRecord(value) &&
    (value.scope === "workspace" ||
      value.scope === "cluster_table" ||
      value.scope === "cluster_queries") &&
    (value.status === "ready" || value.status === "materialization_pending") &&
    (value.source === "workspace_snapshot" ||
      value.source === "sheet_snapshot" ||
      value.source === "sql_direct") &&
    (value.materializationStatus === "materialized" ||
      value.materializationStatus === "fallback_sheet" ||
      value.materializationStatus === "sql_direct" ||
      value.materializationStatus === "pending")
  );
}

export function isProductAdvertisingWorkspaceClusterRow(
  value: unknown,
): value is ProductAdvertisingWorkspaceClusterRow {
  return (
    isRecord(value) &&
    isNonEmptyString(value.clusterKey) &&
    isNullableNumber(value.advertId) &&
    isNullableNonEmptyString(value.campaignName) &&
    isNullableNumber(value.campaignType) &&
    isNullableNumber(value.campaignStatus) &&
    isNullableNonEmptyString(value.paymentType) &&
    isNullableNonEmptyString(value.bidType) &&
    isNullableNonEmptyString(value.currency) &&
    isNonEmptyString(value.clusterName) &&
    isNonEmptyString(value.canonicalNormQuery) &&
    isNullableNumber(value.queryCount) &&
    isNullableNumber(value.jamQueryCount) &&
    isNullableNumber(value.jamFrequency) &&
    isNullableNumber(value.jamClicks) &&
    isNullableNumber(value.jamAddToCart) &&
    isNullableNumber(value.jamOrders) &&
    isNullableNumber(value.jamAvgPosition) &&
    isNullableNumber(value.monthlyFrequency) &&
    isProductAdvertisingSourceKind(value.sourceKind) &&
    (value.isActive === null || typeof value.isActive === "boolean") &&
    isNullableNumber(value.views) &&
    isNullableNumber(value.clicks) &&
    isNullableNumber(value.orders) &&
    isNullableNumber(value.addToCart) &&
    isNullableNumber(value.shks) &&
    isNullableNumber(value.ctr) &&
    isNullableNumber(value.avgPosition) &&
    isNullableNumber(value.cpc) &&
    isNullableNumber(value.cpm) &&
    isNullableNumber(value.spend) &&
    isNullableNumber(value.bid) &&
    (value.bidSyncStatus === null || isProductAdvertisingBidSyncStatus(value.bidSyncStatus)) &&
    isNullableIsoDateString(value.bidConfirmedAt) &&
    isNullableIsoDateString(value.bidRetryAt) &&
    isNullableNonEmptyString(value.bidLastError) &&
    (value.actionSyncStatus === null ||
      isProductAdvertisingActionSyncStatus(value.actionSyncStatus)) &&
    isNullableIsoDateString(value.actionRetryAt) &&
    isNullableNonEmptyString(value.actionLastError) &&
    isNullableIsoDateString(value.updatedAt)
  );
}

function isProductAdvertisingWorkspaceNumericFilterRange(value: unknown) {
  return (
    isRecord(value) &&
    isNullableNumber(value.min) &&
    isNullableNumber(value.max)
  );
}

export function isProductAdvertisingWorkspaceClusterNumericFilters(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isProductAdvertisingWorkspaceNumericFilterRange(value.jamFrequency) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.jamClicks) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.jamAddToCart) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.jamOrders) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.jamAvgPosition) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.jamCtc) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.jamCto) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.monthlyFrequency) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.bid) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.views) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.clicks) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.ctr) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.addToCart) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.ctc) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.orders) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.cto) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.avgPosition) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.cpc) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.cpm) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.cpo) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.viewToOrder) &&
    isProductAdvertisingWorkspaceNumericFilterRange(value.spend)
  );
}

export function isProductAdvertisingWorkspaceClusterTableTotals(
  value: unknown,
): value is ProductAdvertisingWorkspaceClusterTableResponse["totals"] {
  return (
    isRecord(value) &&
    typeof value.count === "number" &&
    isNullableNumber(value.jamQueryCount) &&
    isNullableNumber(value.jamFrequency) &&
    isNullableNumber(value.jamClicks) &&
    isNullableNumber(value.jamAddToCart) &&
    isNullableNumber(value.jamOrders) &&
    isNullableNumber(value.jamAvgPosition) &&
    isNullableNumber(value.monthlyFrequency) &&
    isNullableNumber(value.bid) &&
    isNullableNumber(value.views) &&
    isNullableNumber(value.clicks) &&
    isNullableNumber(value.ctr) &&
    isNullableNumber(value.addToCart) &&
    isNullableNumber(value.ctc) &&
    isNullableNumber(value.orders) &&
    isNullableNumber(value.cto) &&
    isNullableNumber(value.avgPosition) &&
    isNullableNumber(value.cpc) &&
    isNullableNumber(value.cpm) &&
    isNullableNumber(value.cpo) &&
    isNullableNumber(value.viewToOrder) &&
    isNullableNumber(value.spend) &&
    isNullableNonEmptyString(value.currency)
  );
}

export function isProductAdvertisingWorkspaceQuerySearchIndex(
  value: unknown,
): value is ProductAdvertisingWorkspaceClusterTableResponse["querySearchIndex"] {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(
    (entry) => Array.isArray(entry) && entry.every((item) => typeof item === "string"),
  );
}

export function isProductAdvertisingWorkspaceClusterSortKey(
  value: unknown,
): value is ProductAdvertisingWorkspaceClusterSortKey {
  return (
    value === "source" ||
    value === "advertId" ||
    value === "campaignName" ||
    value === "clusterName" ||
    value === "jamFrequency" ||
    value === "jamClicks" ||
    value === "jamAddToCart" ||
    value === "jamOrders" ||
    value === "jamAvgPosition" ||
    value === "jamCtc" ||
    value === "jamCto" ||
    value === "monthlyFrequency" ||
    value === "bid" ||
    value === "views" ||
    value === "clicks" ||
    value === "ctr" ||
    value === "addToCart" ||
    value === "ctc" ||
    value === "orders" ||
    value === "cto" ||
    value === "avgPosition" ||
    value === "cpc" ||
    value === "cpm" ||
    value === "cpo" ||
    value === "viewToOrder" ||
    value === "spend"
  );
}

export function isProductAdvertisingWorkspaceDiagnostics(
  value: unknown,
): value is ProductAdvertisingWorkspaceResponse["diagnostics"] {
  return (
    isRecord(value) &&
    isProductAdvertisingPeriodMetricsStatus(value.periodMetricsStatus) &&
    isNullableDateOnlyString(value.periodMetricsActualStartDate) &&
    isNullableDateOnlyString(value.periodMetricsActualEndDate) &&
    isNullableDateOnlyString(value.dailyStatsWindowStartDate) &&
    isNullableDateOnlyString(value.dailyStatsWindowEndDate) &&
    isProductAdvertisingQueryCoverageStatus(value.queryCoverageStatus)
  );
}

export function isProductAdvertisingWorkspaceSyncState(
  value: unknown,
): value is ProductAdvertisingWorkspaceResponse["syncState"] {
  return (
    isRecord(value) &&
    typeof value.hasPendingClusterSync === "boolean" &&
    (value.refreshStatus === "idle" || value.refreshStatus === "running") &&
    isNullableNonEmptyString(value.syncRunId) &&
    isNullableIsoDateString(value.startedAt)
  );
}

