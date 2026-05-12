import type { Logger } from "@nestjs/common";

import type { SearchQueryTextView } from "../wb-sync/wb-sync.types";
import type { WbRuntimeConfigService } from "../wb-sync/wb-runtime-config.service";
import type { ProductAdvertisingSheetJamOverlay } from "./product-advertising-sheet.builder";
import type { ProductAdvertisingReadRepository } from "./product-advertising-read.repository";
import type { ProductAdvertisingSnapshotMaterializer } from "./product-advertising-snapshot.materializer";
import type { ProductAdvertisingSnapshotResolver } from "./product-advertising-snapshot.resolver";
import type { ProductAdvertisingWorkspaceReadService } from "./product-advertising-workspace-read.service";
import type { ProductPresetSnapshotOrchestratorService } from "./product-preset-snapshot-orchestrator.service";
import type { ProductWorkspaceSnapshotResolver } from "./product-workspace-snapshot.resolver";
import type { PromotionSyncRepository } from "./promotion-sync.repository";
import type { WbClustersActionQueueService } from "./wb-clusters-action-queue.service";
import type { WbClustersBidQueueService } from "./wb-clusters-bid-queue.service";
import type { WbClustersRepository } from "./wb-clusters.repository";
import type {
  ProductAdvertisingSheetResponse,
  ProductSnapshotWarmupPriority,
} from "./wb-clusters.types";
import type { WbPromotionApiClient } from "./wb-promotion-api.client";

type ProductRefreshInFlightEntry = {
  syncRunId: string;
  promise: Promise<void>;
  startedAt: string;
};

type ProductAdvertisingSheetSnapshotCacheEntry = {
  expiresAtMs: number;
  value: ProductAdvertisingSheetResponse;
};

type ProductAdvertisingSheetJamCacheEntry = {
  expiresAtMs: number;
  value: ProductAdvertisingSheetJamOverlay;
};

type ProductWarmupPeriod = {
  start: string;
  end: string;
};

type NormQueryBidRow = {
  advert_id: number;
  nm_id: number;
  norm_query: string;
  bid?: number;
};

export interface WbClustersSnapshotReadContext {
  logger: Pick<Logger, "warn">;
  wbClustersRepository: Pick<WbClustersRepository, "lookupProductClusters">;
  productAdvertisingReadRepository: Pick<
    ProductAdvertisingReadRepository,
    | "getProductAdvertisingSheet"
    | "getWorkspaceClusterRowsSQL"
    | "getWorkspaceClusterQueriesSQL"
    | "getQuerySearchIndexSQL"
  >;
  productAdvertisingSnapshotResolver: Pick<
    ProductAdvertisingSnapshotResolver,
    "resolve" | "resolveMany" | "attachLiveMetadata"
  >;
  productAdvertisingSnapshotMaterializer: Pick<
    ProductAdvertisingSnapshotMaterializer,
    "materializeExactSnapshot"
  >;
  productAdvertisingWorkspaceReadService: Pick<
    ProductAdvertisingWorkspaceReadService,
    | "buildClusterTableResponse"
    | "buildClusterQueriesResponse"
    | "normalizeWorkspaceClusterNumericFilters"
  >;
  productWorkspaceSnapshotResolver: Pick<
    ProductWorkspaceSnapshotResolver,
    | "resolveWorkspaceShell"
    | "resolveWorkspaceCampaignRows"
    | "resolveWorkspaceClusterQueries"
    | "saveWorkspaceCampaignRows"
    | "invalidateWorkspaceCampaignRows"
  >;
  productAdvertisingSheetSnapshotSchemaVersion: number;
  productRefreshInFlight: Map<number, ProductRefreshInFlightEntry>;
  productAdvertisingSheetCacheVersion: Map<number, number>;
  productAdvertisingSheetSnapshotCache: Map<string, ProductAdvertisingSheetSnapshotCacheEntry>;
  productAdvertisingSheetSnapshotInFlight: Map<string, Promise<ProductAdvertisingSheetResponse>>;
  productAdvertisingSheetJamCache: Map<string, ProductAdvertisingSheetJamCacheEntry>;
  productAdvertisingSheetJamInFlight: Map<string, Promise<ProductAdvertisingSheetJamOverlay>>;
  productAdvertisingSheetReadModelCache: Map<string, { expiresAtMs: number; value: ProductAdvertisingSheetResponse }>;
  productAdvertisingSheetReadModelInFlight: Map<string, Promise<ProductAdvertisingSheetResponse>>;
  productAdvertisingSheetReadModelCacheTtlMs: number;
  productAdvertisingSheetJamCacheTtlMs: number;
  productAdvertisingSheetSnapshotCacheTtlMs: number;
  querySearchIndexCache: Map<string, { expiresAtMs: number; value: Record<string, string[]> }>;
  productAdvertisingWorkspaceResponseCache: Map<string, { expiresAtMs: number; response: import("./wb-clusters.types").ProductAdvertisingWorkspaceResponse }>;
  productAdvertisingWorkspaceResponseCacheTtlMs: number;
  normalizeAdvertisingSheetJamRange(startDate: string, endDate: string): ProductWarmupPeriod;
  normalizeAdvertisingText(value: string): string;
  withEmptyJamMetrics(sheet: ProductAdvertisingSheetResponse): ProductAdvertisingSheetResponse;
  enrichProductAdvertisingSheetWithJam(
    sheet: ProductAdvertisingSheetResponse,
    nmId: number,
    currentPeriod: ProductWarmupPeriod,
    allowLiveFetch?: boolean,
  ): Promise<ProductAdvertisingSheetResponse>;
  getOrLoadProductAdvertisingSheetJamOverlay(
    sheet: ProductAdvertisingSheetResponse,
    nmId: number,
    currentPeriod: ProductWarmupPeriod,
    allowLiveFetch: boolean,
  ): Promise<ProductAdvertisingSheetJamOverlay>;
  resolveProductAdvertisingSheetSnapshotCacheTtlMs(
    value: ProductAdvertisingSheetResponse,
  ): number;
  buildProductAdvertisingSheetJamOverlay(
    sheet: ProductAdvertisingSheetResponse,
    nmId: number,
    currentPeriod: ProductWarmupPeriod,
    allowLiveFetch: boolean,
  ): Promise<ProductAdvertisingSheetJamOverlay>;
  loadProductAdvertisingSheetSearchTextsRange(
    nmId: number,
    currentPeriod: ProductWarmupPeriod,
    allowLiveFetch: boolean,
  ): Promise<SearchQueryTextView[]>;
}

export interface WbClustersMaterializeContext {
  logger: Pick<Logger, "warn">;
  wbClustersRepository: Pick<
    WbClustersRepository,
    "getExactReadyProductAdvertisingSnapshotSummaries" | "createOrUpdateProductPresetSnapshotJob"
  >;
  productPresetSnapshotOrchestratorService: Pick<
    ProductPresetSnapshotOrchestratorService,
    "scheduleExactFromSavedExport" | "processJobs"
  >;
  productAdvertisingSnapshotJobService: {
    materializeSnapshots(input: {
      nmIds: number[];
      reason: string;
      explicitPeriod?: ProductWarmupPeriod | null;
      getWarmPeriods: () => ProductWarmupPeriod[];
      materializeSnapshot: (nmId: number, period: ProductWarmupPeriod) => Promise<void>;
      invalidateCaches: (nmId: number) => void;
      concurrency: number;
      onRunning: (nmId: number, period: ProductWarmupPeriod) => void;
      onSucceeded: (nmId: number, period: ProductWarmupPeriod) => void;
      onFailed: (nmId: number, period: ProductWarmupPeriod, errorMessage: string) => void;
    }): Promise<void>;
  };
  productAdvertisingSheetSnapshotSchemaVersion: number;
  normalizeAdvertisingSheetJamRange(startDate: string, endDate: string): ProductWarmupPeriod;
  markProductSnapshotWarmupQueued(
    nmIds: number[],
    period: ProductWarmupPeriod | null,
    exportRequestId: string | null,
    priority: ProductSnapshotWarmupPriority,
  ): void;
  markProductSnapshotWarmupRunning(
    nmIds: number[],
    period: ProductWarmupPeriod,
    exportRequestId: string | null,
  ): void;
  markProductSnapshotWarmupFailed(
    nmIds: number[],
    period: ProductWarmupPeriod,
    exportRequestId: string | null,
    failureReason: string,
  ): void;
  clearProductSnapshotWarmupState(
    nmIds: number[],
    period: ProductWarmupPeriod,
    exportRequestId: string | null,
  ): void;
  scheduleProductAdvertisingSheetWarmup(
    nmIds: number[],
    reason: string,
    explicitPeriod?: ProductWarmupPeriod | null,
    priority?: ProductSnapshotWarmupPriority,
  ): void;
  resolveProductSnapshotWarmupConcurrency(priority: ProductSnapshotWarmupPriority): number;
  materializeProductAdvertisingSheetSnapshot(
    nmId: number,
    currentPeriod: ProductWarmupPeriod,
  ): Promise<void>;
  invalidateProductAdvertisingSheetCaches(nmId: number): void;
  getHourlyProductAdvertisingWarmPeriods(): ProductWarmupPeriod[];
  parseAdvertisingSheetDayValue(value: string): Date;
  formatAdvertisingSheetDate(value: Date): string;
  addAdvertisingSheetDays(value: Date, days: number): Date;
  runExactProductPresetMaterializationFromExport(
    exportRequestId: string,
    nmIds: number[],
    explicitPeriod: ProductWarmupPeriod,
    reason: string,
  ): Promise<void>;
  describeError(error: unknown): string;
}

export interface WbClustersWriteLanesContext {
  logger: Pick<Logger, "warn" | "log">;
  wbPromotionApiClient: Pick<
    WbPromotionApiClient,
    | "hasActiveSellerCooldown"
    | "hasActiveBackgroundReadSuppression"
    | "getSellerCooldownRemainingMs"
    | "getBackgroundReadSuppressionRemainingMs"
    | "hasActiveBidWriteCooldown"
    | "hasActiveMinusWriteCooldown"
  >;
  wbRuntimeConfigService: Pick<WbRuntimeConfigService, "getPromotionTokenSource">;
  wbClustersRepository: Pick<
    WbClustersRepository,
    "isConfigured" | "failActiveClusterBidReconcileJobs"
  >;
  promotionSyncRepository: Pick<PromotionSyncRepository, "isConfigured">;
  wbClustersBidQueueService: Pick<
    WbClustersBidQueueService,
    "processWritePass" | "processReconcilePass"
  >;
  wbClustersActionQueueService: Pick<WbClustersActionQueueService, "processWritePass">;
  productPresetSnapshotOrchestratorService: Pick<
    ProductPresetSnapshotOrchestratorService,
    "processJobs"
  >;
  bidQueuePassTimer: ReturnType<typeof setTimeout> | null;
  actionQueuePassTimer: ReturnType<typeof setTimeout> | null;
  bidQueuePassPromise: Promise<void> | null;
  actionQueuePassPromise: Promise<void> | null;
  bidReconcilePassPromise: Promise<void> | null;
  manualBidBatchWindowMs: number;
  manualBidInteractiveWindowMs: number;
  retryBidInteractiveWindowMs: number;
  maxBidJobsPerPass: number;
  maxActionJobsPerPass: number;
  maxActionGroupsPerBatch: number;
  maxClusterBidJobAttempts: number;
  maxClusterActionJobAttempts: number;
  processClusterBidWritePass(reason: "apply-command" | "cron"): Promise<void> | void;
  processClusterActionWritePass(reason: "apply-command" | "cron"): Promise<void> | void;
  processClusterBidReconcilePass(): Promise<void> | void;
  isManualBidInteractiveWindowActive(): boolean;
  getManualBidInteractiveRemainingMs(): number;
  activateManualBidInteractiveWindow(reason: string, durationMs: number): void;
  isRecoverablePromotionError(error: unknown): boolean;
  invalidateProductAdvertisingSheetCaches(nmId: number): void;
  normalizeAdvertisingText(value: string): string;
  normalizeNormQueryBidsFromWb(
    bids: NormQueryBidRow[],
  ): Array<NormQueryBidRow & { bid?: number }>;
  describeError(error: unknown): string;
  markProductSnapshotWarmupQueued(
    nmIds: number[],
    period: ProductWarmupPeriod | null,
    exportRequestId: string | null,
    priority: ProductSnapshotWarmupPriority,
  ): void;
  markProductSnapshotWarmupRunning(
    nmIds: number[],
    period: ProductWarmupPeriod,
    exportRequestId: string | null,
  ): void;
  markProductSnapshotWarmupFailed(
    nmIds: number[],
    period: ProductWarmupPeriod,
    exportRequestId: string | null,
    failureReason: string,
  ): void;
  clearProductSnapshotWarmupState(
    nmIds: number[],
    period: ProductWarmupPeriod,
    exportRequestId: string | null,
  ): void;
  runExactProductPresetMaterializationFromExport(
    exportRequestId: string,
    nmIds: number[],
    period: ProductWarmupPeriod,
    reason: string,
  ): Promise<void>;
  refreshProductAdvertising(nmId: number): Promise<void>;
  isPromotionLowNoiseModeActive(): boolean;
  getPromotionLowNoiseRemainingMs(): number;
}

type StatsPeriod = {
  from: string;
  to: string;
};

export interface WbClustersStatsSyncContext {
  wbClustersRepository: Pick<
    WbClustersRepository,
    | "saveRawArchives"
    | "getStoredCampaignInventory"
    | "getSyncCursorState"
    | "upsertClusterDailyStats"
    | "upsertClusterStatsBulk"
  >;
  wbPromotionApiClient: Pick<
    WbPromotionApiClient,
    "getDailyNormQueryStats" | "getNormQueryStats"
  >;
  normQueryReadChunkSize: number;
  statsNormQueryChunkSize: number;
  getStatsPeriod(): StatsPeriod;
  chunkArray<T>(items: T[], chunkSize: number): T[][];
  tryApiStep<T>(
    label: string,
    action: () => Promise<T>,
    warningMessages: string[],
  ): Promise<T | null>;
  toIsoDate(date: Date): string;
  readOptionalString(value: unknown): string | null;
  toNullableNumber(value: unknown): number | null;
  updatePhaseCursorState(
    phase: "stats",
    advertId: number,
    syncRunId: string,
    updateGlobal: boolean,
  ): Promise<void>;
}
