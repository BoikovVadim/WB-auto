import type {
  ProductAdvertisingActionJobStatus,
  ProductAdvertisingActionSyncStatus,
  ProductAdvertisingBidJobStatus,
  ProductAdvertisingBidSyncStatus,
  ProductAdvertisingDailyStatsCoverageStatus,
  ProductAdvertisingJamMaterializationStatus,
  ProductAdvertisingPeriodMetricsStatus,
  ProductAdvertisingClusterQueryMappingSource,
  ProductAdvertisingClusterQueryMatchConfidence,
  ProductAdvertisingClusterQuerySource,
  ProductAdvertisingQueryCoverageStatus,
  ProductAdvertisingSnapshotStatus,
  ProductAdvertisingSourceKind,
  ProductSnapshotReadinessStatus,
  ProductSnapshotWarmupPriority,
} from "./syncClientTypes";

export function isProductAdvertisingSourceKind(
  value: unknown,
): value is ProductAdvertisingSourceKind {
  return (
    value === "active" ||
    value === "excluded" ||
    value === "stats" ||
    value === "query-map"
  );
}

export function isProductAdvertisingBidSyncStatus(
  value: unknown,
): value is ProductAdvertisingBidSyncStatus {
  return (
    value === "queued" ||
    value === "sending" ||
    value === "pending" ||
    value === "throttled" ||
    value === "confirmed" ||
    value === "failed"
  );
}

export function isProductAdvertisingActionSyncStatus(
  value: unknown,
): value is ProductAdvertisingActionSyncStatus {
  return (
    value === "queued" ||
    value === "sending" ||
    value === "throttled" ||
    value === "confirmed" ||
    value === "failed"
  );
}

export function isProductAdvertisingBidJobStatus(
  value: unknown,
): value is ProductAdvertisingBidJobStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "retry_scheduled"
  );
}

export function isProductAdvertisingActionJobStatus(
  value: unknown,
): value is ProductAdvertisingActionJobStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "retry_scheduled"
  );
}

export function isProductAdvertisingSnapshotStatus(
  value: unknown,
): value is ProductAdvertisingSnapshotStatus {
  return (
    value === "ready" ||
    value === "building" ||
    value === "failed" ||
    value === "missing"
  );
}

export function isProductAdvertisingJamMaterializationStatus(
  value: unknown,
): value is ProductAdvertisingJamMaterializationStatus {
  return value === "not_requested" || value === "pending" || value === "ready";
}

export function isProductAdvertisingQueryCoverageStatus(
  value: unknown,
): value is ProductAdvertisingQueryCoverageStatus {
  return (
    value === "no-clusters" ||
    value === "missing-query-map" ||
    value === "partial" ||
    value === "ready"
  );
}

export function isProductAdvertisingDailyStatsCoverageStatus(
  value: unknown,
): value is ProductAdvertisingDailyStatsCoverageStatus {
  return (
    value === "not_requested" ||
    value === "full" ||
    value === "partial" ||
    value === "missing"
  );
}

export function isProductAdvertisingPeriodMetricsStatus(
  value: unknown,
): value is ProductAdvertisingPeriodMetricsStatus {
  return value === "exact" || value === "partial" || value === "unavailable";
}

export function isProductAdvertisingClusterQuerySource(
  value: unknown,
): value is ProductAdvertisingClusterQuerySource {
  return (
    value === "cluster-name" ||
    value === "frequency-backed" ||
    value === "stats" ||
    value === "query-map" ||
    value === "soft-match" ||
    value === "cabinet-private-api"
  );
}

export function isProductAdvertisingClusterQueryMappingSource(
  value: unknown,
): value is ProductAdvertisingClusterQueryMappingSource {
  return (
    value === "promotion" ||
    value === "cabinet" ||
    value === "merged" ||
    value === "cluster-name"
  );
}

export function isProductAdvertisingClusterQueryMatchConfidence(
  value: unknown,
): value is ProductAdvertisingClusterQueryMatchConfidence {
  return (
    value === "exact" ||
    value === "trusted-source" ||
    value === "frequency-backed" ||
    value === "stats-backed" ||
    value === "soft-match"
  );
}

export function isProductSnapshotWarmupPriority(
  value: unknown,
): value is ProductSnapshotWarmupPriority {
  return value === "visible" || value === "candidate" || value === "background";
}

export function isProductSnapshotReadinessStatus(
  value: unknown,
): value is ProductSnapshotReadinessStatus {
  return (
    value === "ready" ||
    value === "queued" ||
    value === "running" ||
    value === "missing" ||
    value === "failed" ||
    value === "stale_ready"
  );
}
