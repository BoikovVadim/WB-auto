import type {
  ProductAdvertisingClusterActionResponse,
  ProductAdvertisingClusterBidUpdateResponse,
  ProductAdvertisingMaterializeStartResponse,
  ProductAdvertisingRefreshStartResponse,
  ProductAdvertisingRefreshStatusResponse,
  ProductAdvertisingSheetBundleResponse,
  ProductAdvertisingSyncStartResponse,
  ProductCatalogResponse,
  ProductSnapshotReadinessResponse,
} from "./syncClientTypes";
import {
  isIsoDateString,
  isNonEmptyString,
  isNullableDateOnlyString,
  isNullableIsoDateString,
  isNullableNonEmptyString,
  isRecord,
} from "./syncClientValidatorUtils";
import { assertProductAdvertisingSheetResponse } from "./syncClientAdvertisingCoreValidators";
import {
  isProductAdvertisingActionJobStatus,
  isProductAdvertisingActionSyncStatus,
  isProductAdvertisingBidJobStatus,
  isProductAdvertisingBidSyncStatus,
  isProductAdvertisingRefreshStatus,
  isProductCatalogItem,
  isProductSnapshotReadinessItem,
} from "./syncClientAdvertisingValidatorGuards";

export function assertProductAdvertisingSheetBundleResponse(
  value: unknown,
): asserts value is ProductAdvertisingSheetBundleResponse {
  if (
    !isRecord(value) ||
    !isIsoDateString(value.checkedAt) ||
    !isRecord(value.range) ||
    !isNullableDateOnlyString(value.range.startDate) ||
    value.range.startDate === null ||
    !isNullableDateOnlyString(value.range.endDate) ||
    value.range.endDate === null ||
    !Array.isArray(value.sheets)
  ) {
    throw new Error("Invalid product advertising sheet bundle response.");
  }

  for (const sheet of value.sheets) {
    assertProductAdvertisingSheetResponse(sheet);
  }
}

export function assertProductAdvertisingMaterializeStartResponse(
  value: unknown,
): asserts value is ProductAdvertisingMaterializeStartResponse {
  if (
    !isRecord(value) ||
    typeof value.accepted !== "boolean" ||
    typeof value.nmIdsQueued !== "number" ||
    !isNonEmptyString(value.reason) ||
    !isIsoDateString(value.startedAt)
  ) {
    throw new Error("Invalid product advertising materialize response.");
  }
}

export function assertProductSnapshotReadinessResponse(
  value: unknown,
): asserts value is ProductSnapshotReadinessResponse {
  if (
    !isRecord(value) ||
    !isIsoDateString(value.checkedAt) ||
    !isNullableNonEmptyString(value.exportRequestId) ||
    !isRecord(value.range) ||
    !isNullableDateOnlyString(value.range.startDate) ||
    value.range.startDate === null ||
    !isNullableDateOnlyString(value.range.endDate) ||
    value.range.endDate === null ||
    !Array.isArray(value.items) ||
    value.items.some((item) => !isProductSnapshotReadinessItem(item))
  ) {
    throw new Error("Invalid product snapshot readiness response.");
  }
}

export function assertProductCatalogResponse(value: unknown): asserts value is ProductCatalogResponse {
  if (
    !isRecord(value) ||
    !isIsoDateString(value.checkedAt) ||
    !Array.isArray(value.items) ||
    value.items.some((item) => !isProductCatalogItem(item))
  ) {
    throw new Error("Invalid product catalog response.");
  }
}

export function assertProductAdvertisingRefreshStartResponse(
  value: unknown,
): asserts value is ProductAdvertisingRefreshStartResponse {
  if (
    !isRecord(value) ||
    typeof value.nmId !== "number" ||
    typeof value.accepted !== "boolean" ||
    typeof value.alreadyRunning !== "boolean" ||
    !isNonEmptyString(value.syncRunId) ||
    !isProductAdvertisingRefreshStatus(value.status) ||
    !isIsoDateString(value.startedAt)
  ) {
    throw new Error("Invalid product advertising refresh start response.");
  }
}

export function assertProductAdvertisingRefreshStatusResponse(
  value: unknown,
): asserts value is ProductAdvertisingRefreshStatusResponse {
  if (
    !isRecord(value) ||
    typeof value.nmId !== "number" ||
    !isNonEmptyString(value.syncRunId) ||
    !isProductAdvertisingRefreshStatus(value.status) ||
    !isIsoDateString(value.startedAt) ||
    !isNullableIsoDateString(value.finishedAt) ||
    typeof value.campaignsSeen !== "number" ||
    typeof value.campaignsSynced !== "number" ||
    typeof value.productsSeen !== "number" ||
    typeof value.clustersUpserted !== "number" ||
    typeof value.statsRowsUpserted !== "number" ||
    typeof value.warningCount !== "number" ||
    typeof value.hasPartialFailure !== "boolean" ||
    !isNullableNonEmptyString(value.warningMessage)
  ) {
    throw new Error("Invalid product advertising refresh status response.");
  }
}

export function assertProductAdvertisingClusterActionResponse(
  value: unknown,
): asserts value is ProductAdvertisingClusterActionResponse {
  if (
    !isRecord(value) ||
    typeof value.nmId !== "number" ||
    typeof value.advertId !== "number" ||
    !isNonEmptyString(value.jobId) ||
    !isProductAdvertisingActionJobStatus(value.status) ||
    !isIsoDateString(value.queuedAt) ||
    (value.action !== "include" && value.action !== "exclude") ||
    !Array.isArray(value.actions) ||
    value.actions.some(
      (item) =>
        !isRecord(item) ||
        !isNonEmptyString(item.clusterName) ||
        !isNonEmptyString(item.canonicalNormQuery) ||
        typeof item.desiredIsActive !== "boolean" ||
        !isProductAdvertisingActionSyncStatus(item.status) ||
        !isNullableIsoDateString(item.retryAt) ||
        !isNullableNonEmptyString(item.lastError),
    ) ||
    !isIsoDateString(value.appliedAt)
  ) {
    throw new Error("Invalid product advertising cluster action response.");
  }
}

export function assertProductAdvertisingClusterBidUpdateResponse(
  value: unknown,
): asserts value is ProductAdvertisingClusterBidUpdateResponse {
  if (
    !isRecord(value) ||
    typeof value.nmId !== "number" ||
    typeof value.advertId !== "number" ||
    !isNonEmptyString(value.jobId) ||
    !isProductAdvertisingBidJobStatus(value.status) ||
    !isIsoDateString(value.queuedAt) ||
    !Array.isArray(value.bids) ||
    value.bids.some(
      (item) =>
        !isRecord(item) ||
        !isNonEmptyString(item.clusterName) ||
        !isNonEmptyString(item.canonicalNormQuery) ||
        typeof item.bid !== "number" ||
        !isProductAdvertisingBidSyncStatus(item.status) ||
        !isNullableIsoDateString(item.retryAt) ||
        !isNullableNonEmptyString(item.lastError),
    ) ||
    !isIsoDateString(value.appliedAt)
  ) {
    throw new Error("Invalid product advertising cluster bid update response.");
  }
}

export function assertProductAdvertisingSyncStartResponse(
  value: unknown,
): asserts value is ProductAdvertisingSyncStartResponse {
  if (
    !isRecord(value) ||
    typeof value.accepted !== "boolean" ||
    typeof value.alreadyRunning !== "boolean" ||
    !isNonEmptyString(value.syncRunId) ||
    !isProductAdvertisingRefreshStatus(value.status) ||
    (value.trigger !== "manual" &&
      value.trigger !== "schedule" &&
      value.trigger !== "bootstrap") ||
    (value.mode !== "full" && value.mode !== "inventory") ||
    !isIsoDateString(value.startedAt)
  ) {
    throw new Error("Invalid product advertising sync start response.");
  }
}
