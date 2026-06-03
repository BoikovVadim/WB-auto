export type PromotionTokenSource = "runtime" | "env" | "missing";

export type WbCabinetSessionStatus =
  | "disabled"
  | "missing"
  | "ready"
  | "expired"
  | "error";

export type ClusterSourceKind = "active" | "excluded" | "stats" | "query-map";

export type ClusterSyncStatus = "queued" | "running" | "succeeded" | "failed";
export type ClusterSyncTrigger = "manual" | "schedule" | "bootstrap";
export type ClusterSyncMode = "full" | "inventory" | "structure" | "stats";
export type ClusterSyncPhase = "inventory" | "structure" | "stats";

export type PromotionThrottleLane =
  | "bid-write"
  | "minus-write"
  | "bid-read"
  | "minus-read"
  | "details"
  | "stats"
  | "fullstats"
  | "default";

export type ClusterBidSyncStatus =
  | "queued"
  | "sending"
  | "pending"
  | "throttled"
  | "confirmed"
  | "failed";

export type ClusterActionSyncStatus =
  | "queued"
  | "sending"
  | "throttled"
  | "confirmed"
  | "failed";

export type ClusterBidJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "retry_scheduled";

export type ClusterActionJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "retry_scheduled";

export type ProductPresetSnapshotJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "retry_scheduled";

export type ProductSnapshotWarmupPriority =
  | "startup"
  | "visible"
  | "candidate"
  | "background"
  | "precompute";
