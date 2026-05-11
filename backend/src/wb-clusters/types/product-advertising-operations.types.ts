import type {
  ClusterActionJobStatus,
  ClusterActionSyncStatus,
  ClusterBidJobStatus,
  ClusterBidSyncStatus,
  ClusterSyncStatus,
  ProductSnapshotWarmupPriority,
} from "./core.types";
import type {
  ProductAdvertisingSnapshotFit,
  ProductAdvertisingSnapshotSource,
} from "./product-advertising-sheet.types";

export interface ProductAdvertisingMaterializeStartResponse {
  accepted: boolean;
  nmIdsQueued: number;
  reason: string;
  startedAt: string;
}

export type ProductSnapshotReadinessStatus =
  | "ready"
  | "queued"
  | "running"
  | "missing"
  | "failed"
  | "stale_ready";

export interface ProductSnapshotReadinessItem {
  nmId: number;
  status: ProductSnapshotReadinessStatus;
  priority: ProductSnapshotWarmupPriority | null;
  snapshotFit: ProductAdvertisingSnapshotFit | null;
  snapshotSource: ProductAdvertisingSnapshotSource | null;
  builtAt: string | null;
  failureReason: string | null;
  requestedStartDate: string | null;
  requestedEndDate: string | null;
  snapshotStartDate: string | null;
  snapshotEndDate: string | null;
  updatedAt: string | null;
}

export interface ProductSnapshotReadinessResponse {
  checkedAt: string;
  exportRequestId: string | null;
  range: {
    startDate: string;
    endDate: string;
  };
  items: ProductSnapshotReadinessItem[];
}

export interface ProductAdvertisingRefreshStartResponse {
  nmId: number;
  accepted: boolean;
  alreadyRunning: boolean;
  syncRunId: string;
  status: ClusterSyncStatus;
  startedAt: string;
}

export interface ProductAdvertisingRefreshStatusResponse {
  nmId: number;
  syncRunId: string;
  status: ClusterSyncStatus;
  startedAt: string;
  finishedAt: string | null;
  campaignsSeen: number;
  campaignsSynced: number;
  productsSeen: number;
  clustersUpserted: number;
  statsRowsUpserted: number;
  warningCount: number;
  hasPartialFailure: boolean;
  warningMessage: string | null;
}

export type ProductAdvertisingClusterAction = "include" | "exclude";

export interface ProductAdvertisingClusterActionResponse {
  nmId: number;
  advertId: number;
  jobId: string;
  status: ClusterActionJobStatus;
  queuedAt: string;
  action: ProductAdvertisingClusterAction;
  actions: Array<{
    clusterName: string;
    canonicalNormQuery: string;
    desiredIsActive: boolean;
    status: ClusterActionSyncStatus;
    retryAt: string | null;
    lastError: string | null;
  }>;
  appliedAt: string;
}

export interface ProductAdvertisingClusterBidUpdateResponse {
  nmId: number;
  advertId: number;
  jobId: string;
  status: ClusterBidJobStatus;
  queuedAt: string;
  bids: Array<{
    clusterName: string;
    canonicalNormQuery: string;
    bid: number;
    status: ClusterBidSyncStatus;
    retryAt: string | null;
    lastError: string | null;
  }>;
  appliedAt: string;
}
