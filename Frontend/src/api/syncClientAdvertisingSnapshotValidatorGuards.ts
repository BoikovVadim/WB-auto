import type {
  ProductAdvertisingRefreshStatusResponse,
  ProductAdvertisingSnapshotFit,
  ProductAdvertisingSnapshotSource,
  ProductCatalogItem,
  ProductSnapshotReadinessItem,
} from "./syncClientTypes";
import {
  isIsoDateString,
  isNonEmptyString,
  isNullableDateOnlyString,
  isNullableIsoDateString,
  isNullableNonEmptyString,
  isRecord,
} from "./syncClientValidatorUtils";
import {
  isProductSnapshotReadinessStatus,
  isProductSnapshotWarmupPriority,
} from "./syncClientAdvertisingCoreValidatorGuards";

export function isProductSnapshotReadinessItem(
  value: unknown,
): value is ProductSnapshotReadinessItem {
  return (
    isRecord(value) &&
    typeof value.nmId === "number" &&
    isProductSnapshotReadinessStatus(value.status) &&
    (value.priority === null || isProductSnapshotWarmupPriority(value.priority)) &&
    (value.snapshotFit === null || isProductAdvertisingSnapshotFit(value.snapshotFit)) &&
    (value.snapshotSource === null || isProductAdvertisingSnapshotSource(value.snapshotSource)) &&
    isNullableIsoDateString(value.builtAt) &&
    isNullableNonEmptyString(value.failureReason) &&
    isNullableDateOnlyString(value.requestedStartDate) &&
    isNullableDateOnlyString(value.requestedEndDate) &&
    isNullableDateOnlyString(value.snapshotStartDate) &&
    isNullableDateOnlyString(value.snapshotEndDate) &&
    isNullableIsoDateString(value.updatedAt)
  );
}

function isProductCatalogCampaignCounts(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.total === "number" &&
    typeof value.active === "number" &&
    typeof value.paused === "number" &&
    typeof value.disabled === "number"
  );
}

export function isProductCatalogItem(value: unknown): value is ProductCatalogItem {
  return (
    isRecord(value) &&
    typeof value.nmId === "number" &&
    // vendorCode/name/brandName/subjectName/syncedAt may be empty for products that
    // appear only in campaigns but not in the catalog export.
    typeof value.vendorCode === "string" &&
    typeof value.name === "string" &&
    typeof value.brandName === "string" &&
    typeof value.subjectName === "string" &&
    isNullableNonEmptyString(value.sourceExportRequestId) &&
    isNullableIsoDateString(value.firstSeenAt) &&
    isNullableIsoDateString(value.lastSeenAt) &&
    (value.syncedAt === null || typeof value.syncedAt === "string") &&
    isProductCatalogCampaignCounts(value.campaignCounts)
  );
}

export function isProductAdvertisingSnapshotFit(
  value: unknown,
): value is ProductAdvertisingSnapshotFit {
  return (
    value === "exact" ||
    value === "latest_schema" ||
    value === "closest_range" ||
    value === "most_recent" ||
    value === "live_read_model" ||
    value === "unavailable"
  );
}

export function isProductAdvertisingSnapshotSource(
  value: unknown,
): value is ProductAdvertisingSnapshotSource {
  return (
    value === "exact_snapshot" ||
    value === "latest_schema_snapshot" ||
    value === "closest_range_snapshot" ||
    value === "most_recent_snapshot" ||
    value === "live_read_model" ||
    value === "snapshot_store"
  );
}

export function isProductAdvertisingRefreshStatus(
  value: unknown,
): value is ProductAdvertisingRefreshStatusResponse["status"] {
  return (
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed"
  );
}
