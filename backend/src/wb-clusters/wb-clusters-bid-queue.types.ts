export type ClusterBidJobRecord = {
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
    desiredBid: number;
    confirmedBid: number | null;
    itemStatus: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type ClusterBidReconcileJobRecord = ClusterBidJobRecord & {
  processingPhase: "write" | "reconcile";
};

export type ClusterBidWriteGroup = {
  advertId: number;
  nmId: number;
  jobs: ClusterBidJobRecord[];
};

export type ClusterBidReconcileGroup = {
  advertId: number;
  nmId: number;
  jobs: ClusterBidReconcileJobRecord[];
};

export type PreparedClusterBidWriteGroup = {
  advertId: number;
  nmId: number;
  sortedJobs: ClusterBidJobRecord[];
  mergedBidList: Array<{
    clusterName: string;
    bid: number;
  }>;
  jobIds: string[];
};

export type BidQueueRuntime = {
  maxBidJobsPerPass: number;
  maxClusterBidJobAttempts: number;
  manualBidInteractiveWindowMs: number;
  retryBidInteractiveWindowMs: number;
  activateManualBidInteractiveWindow: (reason: string, durationMs: number) => void;
  isRecoverablePromotionError: (error: unknown) => boolean;
  normalizeAdvertisingText: (value: string) => string;
  normalizeNormQueryBidsFromWb: (
    bids: Array<{
      advert_id: number;
      nm_id: number;
      norm_query: string;
      bid?: number;
    }>,
  ) => Array<{
    advert_id: number;
    nm_id: number;
    norm_query: string;
    bid?: number;
  }>;
};

