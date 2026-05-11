import type {
  ProductAdvertisingActionJobStatus,
  ProductAdvertisingActionSyncStatus,
  ProductAdvertisingBidJobStatus,
  ProductAdvertisingBidSyncStatus,
  ProductAdvertisingSnapshotFit,
  ProductAdvertisingSnapshotSource,
  ProductAdvertisingSheetResponse,
} from "./syncClientAdvertisingSheetTypes";

export interface ProductAdvertisingSheetBundleResponse {
  checkedAt: string;
  range: {
    startDate: string;
    endDate: string;
  };
  sheets: ProductAdvertisingSheetResponse[];
}

export interface ProductAdvertisingMaterializeStartResponse {
  accepted: boolean;
  nmIdsQueued: number;
  reason: string;
  startedAt: string;
}

export type ProductSnapshotWarmupPriority = "visible" | "candidate" | "background";
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

export interface ProductCatalogCampaignCounts {
  total: number;
  active: number;
  paused: number;
  disabled: number;
}

export interface ProductCatalogItem {
  nmId: number;
  vendorCode: string;
  name: string;
  brandName: string;
  subjectName: string;
  sourceExportRequestId: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  syncedAt: string | null;
  campaignCounts: ProductCatalogCampaignCounts;
}

export interface ProductCatalogResponse {
  checkedAt: string;
  items: ProductCatalogItem[];
}

export interface ProductAdvertisingRefreshStartResponse {
  nmId: number;
  accepted: boolean;
  alreadyRunning: boolean;
  syncRunId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  startedAt: string;
}

export interface ProductAdvertisingRefreshStatusResponse {
  nmId: number;
  syncRunId: string;
  status: "queued" | "running" | "succeeded" | "failed";
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

export interface ProductAdvertisingClusterActionResponse {
  nmId: number;
  advertId: number;
  jobId: string;
  status: ProductAdvertisingActionJobStatus;
  queuedAt: string;
  action: "include" | "exclude";
  actions: Array<{
    clusterName: string;
    canonicalNormQuery: string;
    desiredIsActive: boolean;
    status: ProductAdvertisingActionSyncStatus;
    retryAt: string | null;
    lastError: string | null;
  }>;
  appliedAt: string;
}

export interface ProductAdvertisingClusterBidUpdateResponse {
  nmId: number;
  advertId: number;
  jobId: string;
  status: ProductAdvertisingBidJobStatus;
  queuedAt: string;
  bids: Array<{
    clusterName: string;
    canonicalNormQuery: string;
    bid: number;
    status: ProductAdvertisingBidSyncStatus;
    retryAt: string | null;
    lastError: string | null;
  }>;
  appliedAt: string;
}

export interface ProductAdvertisingSyncStartResponse {
  accepted: boolean;
  alreadyRunning: boolean;
  syncRunId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  trigger: "manual" | "schedule" | "bootstrap";
  mode: "full" | "inventory";
  startedAt: string;
}
