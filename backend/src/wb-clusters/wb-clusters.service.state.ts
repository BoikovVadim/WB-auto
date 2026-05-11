import { Logger } from "@nestjs/common";

import { appEnv } from "../common/env";
import { BoundedLruMap } from "./wb-clusters.service.bounded-cache";
import type { WbApiClient } from "../wb-sync/wb-api.client";
import type { WbRuntimeConfigService } from "../wb-sync/wb-runtime-config.service";
import type { WbCabinetPrivateApiClient } from "./wb-cabinet-private-api.client";
import type { WbCmpSafariClient } from "./wb-cmp-safari.client";
import type { ProductAdvertisingSheetJamOverlay } from "./product-advertising-sheet.builder";
import type { ProductAdvertisingReadRepository } from "./product-advertising-read.repository";
import type { ProductAdvertisingSnapshotJobService } from "./product-advertising-snapshot-job.service";
import type { ProductAdvertisingSnapshotMaterializer } from "./product-advertising-snapshot.materializer";
import type { ProductAdvertisingSnapshotResolver } from "./product-advertising-snapshot.resolver";
import type { ProductAdvertisingWorkspaceReadService } from "./product-advertising-workspace-read.service";
import type { ProductPresetSnapshotOrchestratorService } from "./product-preset-snapshot-orchestrator.service";
import type { PromotionSyncRepository } from "./promotion-sync.repository";
import type { WbClustersActionQueueService } from "./wb-clusters-action-queue.service";
import type { WbClustersBidQueueService } from "./wb-clusters-bid-queue.service";
import type { WbClustersRepository } from "./wb-clusters.repository";
import {
  createEmptySyncPhaseTelemetry,
  type SyncPhaseTelemetry,
} from "./wb-clusters-sync.helpers";
import type { WbClustersSyncOrchestratorService } from "./wb-clusters-sync-orchestrator.service";
import type {
  ClusterSyncPhase,
  ProductAdvertisingSheetResponse,
  ProductSnapshotWarmupPriority,
  WbClustersSyncRunSummary,
} from "./wb-clusters.types";
import type { WbPromotionApiClient } from "./wb-promotion-api.client";

export interface ProductSnapshotWarmupState {
  status: "queued" | "running" | "failed";
  priority: ProductSnapshotWarmupPriority;
  updatedAt: string;
  failureReason: string | null;
}

export const productAdvertisingSheetSnapshotSchemaVersion = 11;

export abstract class WbClustersServiceState {
  protected readonly logger = new Logger("WbClustersService");
  protected readonly campaignDetailsChunkSize = appEnv.wbPromotionDetailsChunkSize;
  protected readonly productAdvertisingSheetSnapshotSchemaVersion =
    productAdvertisingSheetSnapshotSchemaVersion;
  protected readonly productAdvertisingSheetCacheVersion = new Map<number, number>();
  protected readonly productAdvertisingSheetJamCache = new BoundedLruMap<
    string,
    {
      expiresAtMs: number;
      value: ProductAdvertisingSheetJamOverlay;
    }
  >(20);
  protected readonly productAdvertisingSheetJamInFlight = new Map<
    string,
    Promise<ProductAdvertisingSheetJamOverlay>
  >();
  protected readonly cmpStepTimeoutMs = 60_000;
  // Hard cap: 5 entries only. Snapshot loading is now a fallback path; the
  // SQL-direct fast path handles all user-facing reads without this cache.
  protected readonly productAdvertisingSheetSnapshotCache = new BoundedLruMap<
    string,
    {
      expiresAtMs: number;
      value: ProductAdvertisingSheetResponse;
    }
  >(5);
  protected readonly productAdvertisingSheetSnapshotInFlight = new Map<
    string,
    Promise<ProductAdvertisingSheetResponse>
  >();
  protected readonly productSnapshotWarmupState = new Map<string, ProductSnapshotWarmupState>();
  // Response-level cache for the /workspace endpoint (workspace shell, no cluster tables).
  // Keyed by nmId:startDate:endDate. Short TTL (3 min) — workspace shell is cheap to rebuild
  // but caching avoids repeated DB reads when the user rapidly switches products.
  // Invalidated per nmId on sync.
  // 15 entries: covers the user switching between products during a session.
  protected readonly productAdvertisingWorkspaceResponseCache = new BoundedLruMap<
    string,
    {
      expiresAtMs: number;
      response: import("./wb-clusters.types").ProductAdvertisingWorkspaceResponse;
    }
  >(15);
  protected readonly productAdvertisingWorkspaceResponseCacheTtlMs = 3 * 60 * 1000;

  // Query search index cache: built from wb_cabinet_cluster_queries + wb_cluster_queries
  // per (nmId, advertId, cacheVersion). Used to populate querySearchIndex in cluster table
  // responses without PATH B. Cache version auto-invalidates on sync.
  // 50 entries: covers all campaigns across ~5 concurrently open products.
  protected readonly querySearchIndexCache = new BoundedLruMap<
    string,
    { expiresAtMs: number; value: Record<string, string[]> }
  >(50);

  // Кеш live aggregation read model: результат buildProductAdvertisingSheetReadModel
  // (сборка из daily stats) для nmId + period. Переиспользуется всеми кампаниями
  // одного товара и всеми рекурсивными запросами в рамках одного периода.
  // TTL 10 мин — безопасен: синки приходят раз в 10+ мин; инвалидируется принудительно
  // через invalidateProductAdvertisingSheetCaches при обновлении данных.
  // 5 entries: read model is only needed as fallback or for search overlay.
  protected readonly productAdvertisingSheetReadModelCache = new BoundedLruMap<
    string,
    { expiresAtMs: number; value: ProductAdvertisingSheetResponse }
  >(5);
  protected readonly productAdvertisingSheetReadModelInFlight = new Map<
    string,
    Promise<ProductAdvertisingSheetResponse>
  >();
  protected readonly productAdvertisingSheetReadModelCacheTtlMs = 10 * 60 * 1000;
  protected readonly productAdvertisingSheetJamCacheTtlMs = 10 * 60 * 1000;
  protected readonly productAdvertisingSheetSnapshotCacheTtlMs = 65 * 60 * 1000;
  protected readonly normQueryReadChunkSize = 100;
  protected readonly maxBidJobsPerPass = 200;
  protected readonly maxActionJobsPerPass = 200;
  protected readonly maxActionGroupsPerBatch = 50;
  protected readonly maxClusterBidJobAttempts = 8;
  protected readonly maxClusterActionJobAttempts = 8;
  protected readonly manualBidBatchWindowMs = 250;
  protected readonly manualBidInteractiveWindowMs = 60_000;
  protected readonly retryBidInteractiveWindowMs = 15_000;
  protected syncInFlight: Promise<WbClustersSyncRunSummary> | null = null;
  protected currentSyncRunId: string | null = null;
  protected jamSyncInFlight: Promise<void> | null = null;
  protected readonly productRefreshInFlight = new Map<
    number,
    {
      syncRunId: string;
      promise: Promise<void>;
      startedAt: string;
    }
  >();
  protected bidQueuePassPromise: Promise<void> | null = null;
  protected bidQueuePassTimer: ReturnType<typeof setTimeout> | null = null;
  protected actionQueuePassPromise: Promise<void> | null = null;
  protected actionQueuePassTimer: ReturnType<typeof setTimeout> | null = null;
  protected bidReconcilePassPromise: Promise<void> | null = null;
  protected manualBidInteractiveUntilMs = 0;
  protected readonly syncPhaseTelemetry: Record<ClusterSyncPhase, SyncPhaseTelemetry> = {
    inventory: createEmptySyncPhaseTelemetry(),
    structure: createEmptySyncPhaseTelemetry(),
    stats: createEmptySyncPhaseTelemetry(),
  };

  /**
   * Remove all expired entries from a TTL-keyed Map in one pass.
   * Call periodically to prevent unbounded growth when the server runs for days
   * with thousands of unique (nmId × period) cache keys.
   */
  protected pruneExpiredEntries<V extends { expiresAtMs: number }>(
    cache: Map<string, V>,
  ): void {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now >= entry.expiresAtMs) {
        cache.delete(key);
      }
    }
  }

  protected pruneInMemoryCaches(): void {
    this.pruneExpiredEntries(this.productAdvertisingSheetJamCache);
    this.pruneExpiredEntries(this.productAdvertisingSheetSnapshotCache);
    this.pruneExpiredEntries(this.productAdvertisingWorkspaceResponseCache);
    this.pruneExpiredEntries(this.productAdvertisingSheetReadModelCache);
    this.pruneExpiredEntries(this.querySearchIndexCache);
  }

  protected abstract readonly wbCabinetPrivateApiClient: WbCabinetPrivateApiClient;
  protected abstract readonly wbPromotionApiClient: WbPromotionApiClient;
  protected abstract readonly wbApiClient: WbApiClient;
  protected abstract readonly wbCmpSafariClient: WbCmpSafariClient;
  protected abstract readonly wbClustersRepository: WbClustersRepository;
  protected abstract readonly promotionSyncRepository: PromotionSyncRepository;
  protected abstract readonly productAdvertisingReadRepository: ProductAdvertisingReadRepository;
  protected abstract readonly productAdvertisingSnapshotResolver: ProductAdvertisingSnapshotResolver;
  protected abstract readonly productAdvertisingSnapshotMaterializer: ProductAdvertisingSnapshotMaterializer;
  protected abstract readonly productAdvertisingSnapshotJobService: ProductAdvertisingSnapshotJobService;
  protected abstract readonly productAdvertisingWorkspaceReadService: ProductAdvertisingWorkspaceReadService;
  protected abstract readonly wbRuntimeConfigService: WbRuntimeConfigService;
  protected abstract readonly productPresetSnapshotOrchestratorService: ProductPresetSnapshotOrchestratorService;
  protected abstract readonly wbClustersSyncOrchestratorService: WbClustersSyncOrchestratorService;
  protected abstract readonly wbClustersActionQueueService: WbClustersActionQueueService;
  protected abstract readonly wbClustersBidQueueService: WbClustersBidQueueService;
}
