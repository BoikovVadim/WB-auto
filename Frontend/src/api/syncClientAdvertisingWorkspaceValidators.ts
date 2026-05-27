import type {
  ProductAdvertisingWorkspaceClusterQueriesResponse,
  ProductAdvertisingWorkspaceClusterTableResponse,
  ProductAdvertisingWorkspaceResponse,
} from "./syncClientTypes";
import {
  isIsoDateString,
  isNonEmptyString,
  isNullableDateOnlyString,
  isNullableNonEmptyString,
  isNullableNumber,
  isRecord,
} from "./syncClientValidatorUtils";
import {
  isProductAdvertisingClusterQuery,
  isProductAdvertisingWorkspaceCampaignTab,
  isProductAdvertisingWorkspaceClusterRow,
  isProductAdvertisingWorkspaceClusterNumericFilters,
  isProductAdvertisingWorkspaceDiagnostics,
  isProductAdvertisingWorkspaceReadiness,
  isProductAdvertisingReadModelRevision,
  isProductAdvertisingWorkspaceClusterSortKey,
  isProductAdvertisingWorkspaceSyncState,
  isProductAdvertisingWorkspaceClusterTableTotals,
  isProductAdvertisingWorkspaceQuerySearchIndex,
} from "./syncClientAdvertisingValidatorGuards";

export function assertProductAdvertisingWorkspaceResponse(
  value: unknown,
): asserts value is ProductAdvertisingWorkspaceResponse {
  if (
    !isRecord(value) ||
    typeof value.nmId !== "number" ||
    !isIsoDateString(value.checkedAt) ||
    !isRecord(value.header) ||
    typeof value.header.nmId !== "number" ||
    !isNullableNonEmptyString(value.header.vendorCode) ||
    !isNullableNonEmptyString(value.header.productName) ||
    !isNullableNonEmptyString(value.header.brandName) ||
    !isNullableNonEmptyString(value.header.subjectName) ||
    !isProductAdvertisingReadModelRevision(value.revision) ||
    !isRecord(value.snapshot) ||
    !isRecord(value.range) ||
    !isRecord(value.dateBounds) ||
    !isNullableDateOnlyString(value.dateBounds.minDate) ||
    !isNullableDateOnlyString(value.dateBounds.maxDate) ||
    !isNullableDateOnlyString(value.dateBounds.defaultStartDate) ||
    !isNullableDateOnlyString(value.dateBounds.defaultEndDate) ||
    !isProductAdvertisingWorkspaceReadiness(value.readiness) ||
    !Array.isArray(value.campaignTabs) ||
    value.campaignTabs.some((item) => !isProductAdvertisingWorkspaceCampaignTab(item)) ||
    !isNullableNumber(value.defaultCampaignId) ||
    (value.selectedCampaignSummary !== null &&
      !isProductAdvertisingWorkspaceCampaignTab(value.selectedCampaignSummary)) ||
    (value.initialClusterTable !== null &&
      value.initialClusterTable !== undefined &&
      !isRecord(value.initialClusterTable)) ||
    !isProductAdvertisingWorkspaceSyncState(value.syncState) ||
    !isProductAdvertisingWorkspaceDiagnostics(value.diagnostics)
  ) {
    throw new Error("Invalid product advertising workspace response.");
  }

  if (
    value.initialClusterTable !== null &&
    value.initialClusterTable !== undefined
  ) {
    assertProductAdvertisingWorkspaceClusterTableResponse(value.initialClusterTable);
  }
}

export function assertProductAdvertisingWorkspaceClusterTableResponse(
  value: unknown,
): asserts value is ProductAdvertisingWorkspaceClusterTableResponse {
  if (
    !isRecord(value) ||
    typeof value.nmId !== "number" ||
    typeof value.advertId !== "number" ||
    !isIsoDateString(value.checkedAt) ||
    !isProductAdvertisingReadModelRevision(value.revision) ||
    !isProductAdvertisingWorkspaceReadiness(value.readiness) ||
    !Array.isArray(value.rows) ||
    value.rows.some((item) => !isProductAdvertisingWorkspaceClusterRow(item)) ||
    (value.querySearchIndex !== undefined &&
      value.querySearchIndex !== null &&
      !isProductAdvertisingWorkspaceQuerySearchIndex(value.querySearchIndex)) ||
    !isProductAdvertisingWorkspaceClusterTableTotals(value.totals) ||
    value.totalsScope !== "filtered_population" ||
    !isRecord(value.filterCounts) ||
    typeof value.filterCounts.all !== "number" ||
    typeof value.filterCounts.active !== "number" ||
    typeof value.filterCounts.excluded !== "number" ||
    !isRecord(value.appliedFilters) ||
    typeof value.appliedFilters.search !== "string" ||
    typeof value.appliedFilters.clusterNameSearch !== "string" ||
    !(value.appliedFilters.status === "all" ||
      value.appliedFilters.status === "active" ||
      value.appliedFilters.status === "excluded") ||
    !isProductAdvertisingWorkspaceClusterNumericFilters(value.appliedFilters.numericFilters) ||
    !isRecord(value.sort) ||
    !isProductAdvertisingWorkspaceClusterSortKey(value.sort.key) ||
    !(value.sort.direction === "asc" || value.sort.direction === "desc") ||
    !isRecord(value.pagination) ||
    typeof value.pagination.page !== "number" ||
    typeof value.pagination.pageSize !== "number" ||
    typeof value.pagination.totalRows !== "number" ||
    typeof value.pagination.totalPages !== "number"
  ) {
    throw new Error("Invalid product advertising workspace cluster table response.");
  }
}

export function assertProductAdvertisingWorkspaceClusterQueriesResponse(
  value: unknown,
): asserts value is ProductAdvertisingWorkspaceClusterQueriesResponse {
  if (
    !isRecord(value) ||
    typeof value.nmId !== "number" ||
    typeof value.advertId !== "number" ||
    !isNonEmptyString(value.clusterKey) ||
    !isNonEmptyString(value.clusterName) ||
    !isIsoDateString(value.checkedAt) ||
    !isProductAdvertisingReadModelRevision(value.revision) ||
    !isProductAdvertisingWorkspaceReadiness(value.readiness) ||
    !Array.isArray(value.queries) ||
    value.queries.some((item) => !isProductAdvertisingClusterQuery(item)) ||
    !isRecord(value.sort) ||
    !isProductAdvertisingWorkspaceClusterSortKey(value.sort.key) ||
    !(value.sort.direction === "asc" || value.sort.direction === "desc")
  ) {
    throw new Error("Invalid product advertising workspace cluster queries response.");
  }
}
