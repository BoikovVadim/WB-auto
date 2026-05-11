import type {
  ClusterSyncMode,
  ClusterSyncPhase,
  ClusterSyncStatus,
  ClusterSyncTrigger,
  PromotionThrottleLane,
  PromotionTokenSource,
  WbCabinetSessionStatus,
} from "./core.types";

export interface WbClustersSyncRunSummary {
  syncRunId: string;
  status: ClusterSyncStatus;
  trigger: ClusterSyncTrigger;
  startedAt: string;
  finishedAt: string | null;
  campaignsSeen: number;
  campaignsSynced: number;
  productsSeen: number;
  clustersUpserted: number;
  statsRowsUpserted: number;
  warningCount: number;
  hasPartialFailure: boolean;
  errorMessage: string | null;
}

export interface WbClustersSyncStartResponse {
  accepted: boolean;
  alreadyRunning: boolean;
  syncRunId: string;
  status: ClusterSyncStatus;
  trigger: ClusterSyncTrigger;
  mode: ClusterSyncMode;
  startedAt: string;
}

export interface WbClustersStatusResponse {
  service: "wb-clusters";
  dbConfigured: boolean;
  promotionTokenConfigured: boolean;
  promotionTokenSource: PromotionTokenSource;
  cabinetSession: {
    enabled: boolean;
    status: WbCabinetSessionStatus;
    storageStatePath: string | null;
    supplierId: string | null;
    expiresAt: string | null;
    checkedAt: string;
    warning: string | null;
  };
  scheduleEnabled: boolean;
  syncStrategy: "continuous-global-batching";
  statsLookbackDays: number;
  activeSyncRunId: string | null;
  syncCursor: {
    lastCompletedAdvertId: number | null;
    lastSyncRunId: string | null;
  };
  syncPhaseCursors: Record<
    ClusterSyncPhase,
    {
      lastCompletedAdvertId: number | null;
      lastSyncRunId: string | null;
    }
  >;
  phaseCoverage: Record<ClusterSyncPhase, "full-pool">;
  phaseChunkSizes: {
    detailsAdvertIdsPerRequest: number;
    normQueryItemsPerRequest: number;
  };
  estimatedFullSweepMinutes: number | null;
  estimatedPhaseSweepMinutes: Record<ClusterSyncPhase, number | null>;
  phaseTelemetry: Record<
    ClusterSyncPhase,
    {
      runs: number;
      campaignsProcessed: number;
      avgCampaignsPerMinute: number | null;
      lastElapsedMs: number | null;
      lastFinishedAt: string | null;
    }
  >;
  promotionApiTelemetry: {
    backgroundReadSuppressionRemainingMs: number;
    sellerCooldownRemainingMs: number;
    lanes: Record<
      PromotionThrottleLane,
      {
        pendingRequests: number;
        cooldownRemainingMs: number;
        requestsStarted: number;
        requestsCompleted: number;
        requestsFailed: number;
        retryCount: number;
        tooManyRequestsCount: number;
        avgWaitMs: number | null;
        avgDurationMs: number | null;
        lastWaitMs: number | null;
        lastDurationMs: number | null;
        lastPath: string | null;
        lastErrorStatusCode: number | null;
        lastStartedAt: string | null;
        lastFinishedAt: string | null;
      }
    >;
  };
  campaignsStored: number;
  productsStored: number;
  clustersStored: number;
  statsRowsStored: number;
  lastSyncRun: WbClustersSyncRunSummary | null;
  checkedAt: string;
}
