import type {
  ClusterActionSyncStatus,
  ClusterBidSyncStatus,
  ClusterSourceKind,
} from "./types/core.types";
import type {
  ProductAdvertisingClusterQueryMappingSource,
  ProductAdvertisingClusterQueryMatchConfidence,
  ProductAdvertisingClusterQuerySource,
  ProductAdvertisingDailyStatsCoverageStatus,
  ProductAdvertisingJamMaterializationStatus,
  ProductAdvertisingPeriodMetricsStatus,
  ProductAdvertisingQueryCoverageStatus,
  ProductAdvertisingSheetResponse,
  ProductAdvertisingSnapshotFit,
  ProductAdvertisingSnapshotSource,
  ProductAdvertisingSnapshotStatus,
} from "./types/product-advertising-sheet.types";

export type NormalizationResult<T> = {
  value: T | null;
  issue: string | null;
  repaired: boolean;
};

export type RootCounts = Pick<
  ProductAdvertisingSheetResponse["summary"],
  | "campaignsCount"
  | "clustersCount"
  | "clusterQueriesCount"
  | "dailyStatsCount"
  | "minusPhrasesCount"
  | "keywordStatsCount"
>;

const clusterSourceKinds = new Set<ClusterSourceKind>(["active", "excluded", "stats", "query-map"]);
const clusterBidSyncStatuses = new Set<ClusterBidSyncStatus>([
  "queued",
  "sending",
  "pending",
  "throttled",
  "confirmed",
  "failed",
]);
const clusterActionSyncStatuses = new Set<ClusterActionSyncStatus>([
  "queued",
  "sending",
  "throttled",
  "confirmed",
  "failed",
]);
const clusterQuerySources = new Set<ProductAdvertisingClusterQuerySource>([
  "cluster-name",
  "frequency-backed",
  "stats",
  "query-map",
  "soft-match",
  "cabinet-private-api",
]);
const clusterQueryMappingSources = new Set<ProductAdvertisingClusterQueryMappingSource>([
  "promotion",
  "cabinet",
  "merged",
  "cluster-name",
]);
const clusterQueryMatchConfidence = new Set<ProductAdvertisingClusterQueryMatchConfidence>([
  "exact",
  "trusted-source",
  "frequency-backed",
  "stats-backed",
  "soft-match",
]);
const queryCoverageStatuses = new Set<ProductAdvertisingQueryCoverageStatus>([
  "no-clusters",
  "missing-query-map",
  "partial",
  "ready",
]);
const dailyStatsCoverageStatuses = new Set<ProductAdvertisingDailyStatsCoverageStatus>([
  "not_requested",
  "full",
  "partial",
  "missing",
]);
const periodMetricsStatuses = new Set<ProductAdvertisingPeriodMetricsStatus>([
  "exact",
  "partial",
  "unavailable",
]);
const snapshotStatuses = new Set<ProductAdvertisingSnapshotStatus>([
  "ready",
  "building",
  "failed",
  "missing",
]);
const snapshotFits = new Set<ProductAdvertisingSnapshotFit>([
  "exact",
  "latest_schema",
  "closest_range",
  "most_recent",
  "live_read_model",
  "unavailable",
]);
const snapshotSources = new Set<ProductAdvertisingSnapshotSource>([
  "exact_snapshot",
  "latest_schema_snapshot",
  "closest_range_snapshot",
  "most_recent_snapshot",
  "live_read_model",
  "snapshot_store",
]);
const jamStatuses = new Set<ProductAdvertisingJamMaterializationStatus>([
  "not_requested",
  "pending",
  "ready",
]);

export function normalizeArray<T>(
  value: unknown,
  path: string,
  issues: string[],
  normalizeItem: (value: unknown, path: string, issues: string[]) => T | null,
) {
  if (!Array.isArray(value)) {
    issues.push(`${path} is missing; defaulted to [].`);
    return [] as T[];
  }

  const normalized: T[] = [];
  for (const [index, item] of value.entries()) {
    const nextItem = normalizeItem(item, `${path}[${index}]`, issues);
    if (nextItem) {
      normalized.push(nextItem);
    }
  }
  return normalized;
}

export function asClusterSourceKind(value: unknown): ClusterSourceKind | null {
  return typeof value === "string" && clusterSourceKinds.has(value as ClusterSourceKind)
    ? (value as ClusterSourceKind)
    : null;
}

export function asClusterBidSyncStatus(value: unknown): ClusterBidSyncStatus | null {
  return typeof value === "string" && clusterBidSyncStatuses.has(value as ClusterBidSyncStatus)
    ? (value as ClusterBidSyncStatus)
    : null;
}

export function asClusterActionSyncStatus(value: unknown): ClusterActionSyncStatus | null {
  return typeof value === "string" && clusterActionSyncStatuses.has(value as ClusterActionSyncStatus)
    ? (value as ClusterActionSyncStatus)
    : null;
}

export function asClusterQuerySource(value: unknown): ProductAdvertisingClusterQuerySource | null {
  return typeof value === "string" && clusterQuerySources.has(value as ProductAdvertisingClusterQuerySource)
    ? (value as ProductAdvertisingClusterQuerySource)
    : null;
}

export function asClusterQueryMappingSource(
  value: unknown,
): ProductAdvertisingClusterQueryMappingSource | null {
  return typeof value === "string" &&
    clusterQueryMappingSources.has(value as ProductAdvertisingClusterQueryMappingSource)
    ? (value as ProductAdvertisingClusterQueryMappingSource)
    : null;
}

export function asClusterQueryMatchConfidence(
  value: unknown,
): ProductAdvertisingClusterQueryMatchConfidence | null {
  return typeof value === "string" &&
    clusterQueryMatchConfidence.has(value as ProductAdvertisingClusterQueryMatchConfidence)
    ? (value as ProductAdvertisingClusterQueryMatchConfidence)
    : null;
}

export function asQueryCoverageStatus(value: unknown): ProductAdvertisingQueryCoverageStatus | null {
  return typeof value === "string" && queryCoverageStatuses.has(value as ProductAdvertisingQueryCoverageStatus)
    ? (value as ProductAdvertisingQueryCoverageStatus)
    : null;
}

export function asDailyStatsCoverageStatus(
  value: unknown,
): ProductAdvertisingDailyStatsCoverageStatus | null {
  return typeof value === "string" &&
    dailyStatsCoverageStatuses.has(value as ProductAdvertisingDailyStatsCoverageStatus)
    ? (value as ProductAdvertisingDailyStatsCoverageStatus)
    : null;
}

export function asPeriodMetricsStatus(value: unknown): ProductAdvertisingPeriodMetricsStatus | null {
  return typeof value === "string" &&
    periodMetricsStatuses.has(value as ProductAdvertisingPeriodMetricsStatus)
    ? (value as ProductAdvertisingPeriodMetricsStatus)
    : null;
}

export function asSnapshotStatus(value: unknown): ProductAdvertisingSnapshotStatus | null {
  return typeof value === "string" && snapshotStatuses.has(value as ProductAdvertisingSnapshotStatus)
    ? (value as ProductAdvertisingSnapshotStatus)
    : null;
}

export function asSnapshotFit(value: unknown): ProductAdvertisingSnapshotFit | null {
  return typeof value === "string" && snapshotFits.has(value as ProductAdvertisingSnapshotFit)
    ? (value as ProductAdvertisingSnapshotFit)
    : null;
}

export function asSnapshotSource(value: unknown): ProductAdvertisingSnapshotSource | null {
  return typeof value === "string" && snapshotSources.has(value as ProductAdvertisingSnapshotSource)
    ? (value as ProductAdvertisingSnapshotSource)
    : null;
}

export function asJamStatus(value: unknown): ProductAdvertisingJamMaterializationStatus | null {
  return typeof value === "string" && jamStatuses.has(value as ProductAdvertisingJamMaterializationStatus)
    ? (value as ProductAdvertisingJamMaterializationStatus)
    : null;
}

export function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asNumberOrNull(value: unknown) {
  return asNumber(value);
}

export function asBoolean(value: unknown) {
  return value === true;
}

export function asBooleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function asNonEmptyStringOrNull(value: unknown) {
  return asNonEmptyString(value);
}

export function asIsoDateTime(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return null;
  }

  return new Date(value).toISOString();
}

export function asDateOnly(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function trackRepair<T>(issues: string[], path: string, fallback: T) {
  issues.push(`${path} was incompatible and was replaced with a fallback value.`);
  return fallback;
}
