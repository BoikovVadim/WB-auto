export type ClusterActionJobRecord = {
  jobId: string;
  advertId: number;
  nmId: number;
  status: string;
  attemptCount: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    clusterName: string;
    normalizedClusterName: string;
    desiredIsActive: boolean;
    itemStatus: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type ClusterActionWriteGroup = {
  advertId: number;
  nmId: number;
  jobs: ClusterActionJobRecord[];
};

export type PreparedClusterActionWriteGroup = {
  advertId: number;
  nmId: number;
  sortedJobs: ClusterActionJobRecord[];
  mergedActionList: Array<{
    clusterName: string;
    normalizedClusterName: string;
    desiredIsActive: boolean;
  }>;
  jobIds: string[];
};

export type ClusterActionMinusRequestItem = {
  advert_id: number;
  nm_id: number;
  norm_queries: string[];
};

export type ActionQueueRuntime = {
  maxActionJobsPerPass: number;
  maxActionGroupsPerBatch: number;
  maxClusterActionJobAttempts: number;
  manualBidInteractiveWindowMs: number;
  retryBidInteractiveWindowMs: number;
  activateManualBidInteractiveWindow: (reason: string, durationMs: number) => void;
  isRecoverablePromotionError: (error: unknown) => boolean;
  normalizeAdvertisingText: (value: string) => string;
};

