import { ServiceUnavailableException } from "@nestjs/common";

import {
  buildProductAdvertisingSheetJamOverlay as buildProductAdvertisingSheetJamOverlayValue,
  buildProductAdvertisingSheetCacheKey,
  enrichProductAdvertisingSheetWithJam as enrichProductAdvertisingSheetWithJamValue,
  invalidateProductAdvertisingSheetCaches as invalidateProductAdvertisingSheetCachesValue,
} from "./product-advertising-sheet.snapshot";
import { buildProductAdvertisingWorkspaceClusterQueriesResponse } from "./product-workspace-cluster-queries.builder";
import { buildProductAdvertisingWorkspaceClusterTableResponse } from "./product-workspace-cluster-table.builder";
import { withEmptyJamMetrics as withEmptyJamMetricsValue } from "./product-advertising-sheet.builder";
import type { SearchQueryTextView } from "../wb-sync/wb-sync.types";
import type {
  ProductAdvertisingSheetBundleResponse,
  ProductAdvertisingSheetResponse,
} from "./types/product-advertising-sheet.types";
import type {
  ProductAdvertisingWorkspaceBundleResponse,
  ProductAdvertisingWorkspaceClusterQueriesResponse,
  ProductAdvertisingWorkspaceClusterTableResponse,
} from "./types/product-advertising-workspace.types";
import type { WbClustersSnapshotReadContext } from "./wb-clusters.flow-context";

export async function getProductAdvertisingSheet(
  self: WbClustersSnapshotReadContext,
  nmId: number,
  input?: {
    startDate?: string;
    endDate?: string;
  },
): Promise<ProductAdvertisingSheetResponse> {
  if (!input?.startDate || !input?.endDate) {
    return self.productAdvertisingSnapshotResolver.resolve({
      nmId,
      currentPeriod: null,
      schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
    });
  }

  const currentPeriod = self.normalizeAdvertisingSheetJamRange(input.startDate, input.endDate);
  return getOrLoadProductAdvertisingSheetSnapshot(self, nmId, currentPeriod);
}

/**
 * Returns the query search index for (nmId, advertId) from a short-lived in-memory
 * cache keyed by cacheVersion, so the DB is queried at most once per sync cycle
 * per campaign. Falls back to {} on any DB error so the cluster table still renders.
 */
async function getOrBuildQuerySearchIndex(
  self: WbClustersSnapshotReadContext,
  nmId: number,
  advertId: number,
): Promise<Record<string, string[]>> {
  const cacheVersion = self.productAdvertisingSheetCacheVersion.get(nmId) ?? 0;
  const cacheKey = `${nmId}:${advertId}:v${cacheVersion}`;
  const cached = self.querySearchIndexCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAtMs) {
    return cached.value;
  }
  const value = await self.productAdvertisingReadRepository
    .getQuerySearchIndexSQL(nmId, advertId)
    .catch(() => ({}));
  self.querySearchIndexCache.set(cacheKey, {
    expiresAtMs: Date.now() + 20 * 60 * 1000,
    value,
  });
  return value;
}

export async function getProductAdvertisingWorkspace(
  self: WbClustersSnapshotReadContext,
  nmId: number,
  input?: {
    startDate?: string;
    endDate?: string;
  },
) {
  const currentRefresh = self.productRefreshInFlight.get(nmId);
  const currentPeriod =
    input?.startDate && input?.endDate
      ? self.normalizeAdvertisingSheetJamRange(input.startDate, input.endDate)
      : null;

  const workspace = await self.productWorkspaceSnapshotResolver.resolveWorkspaceShell({
    nmId,
    currentPeriod,
    schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
    currentRefresh: currentRefresh
      ? { syncRunId: currentRefresh.syncRunId, startedAt: currentRefresh.startedAt }
      : null,
  });

  const selectedCampaignAdvertId = workspace.selectedCampaignSummary?.advertId ?? null;
  if (selectedCampaignAdvertId === null) {
    return workspace;
  }

  try {
    const storedRows = await self.productWorkspaceSnapshotResolver.resolveWorkspaceCampaignRows({
      nmId,
      advertId: selectedCampaignAdvertId,
      currentPeriod,
      schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
    });

    if (storedRows) {
      return {
        ...workspace,
        initialClusterTable: self.productAdvertisingWorkspaceReadService.buildClusterTableResponse({
          nmId,
          snapshot: storedRows.payload,
          advertId: selectedCampaignAdvertId,
          status: "all",
          search: "",
          sortKey: "spend",
          sortDirection: "desc",
          page: 1,
          pageSize: 5000,
        }),
      };
    }
  } catch (error) {
    if (!(error instanceof ServiceUnavailableException)) {
      throw error;
    }
  }

  return workspace;
}

export async function getProductAdvertisingWorkspaceBundle(
  self: WbClustersSnapshotReadContext,
  nmId: number,
  input?: {
    startDate?: string;
    endDate?: string;
  },
): Promise<ProductAdvertisingWorkspaceBundleResponse> {
  const workspace = await getProductAdvertisingWorkspace(self, nmId, input);

  type ClusterTable = Awaited<ReturnType<typeof getProductAdvertisingWorkspaceClusterTable>>;
  const clusterTables: Record<string, ClusterTable> = {};

  // Fetch ALL campaign tables in parallel — one DB read per campaign, all concurrent.
  // This turns N individual HTTP round-trips into a single request, making campaign
  // switching and date changes instantaneous on the frontend.
  const campaignTabs = workspace.campaignTabs ?? [];
  if (campaignTabs.length > 0) {
    const tableEntries = await Promise.all(
      campaignTabs.map(async (tab) => {
        const table = await getProductAdvertisingWorkspaceClusterTable(
          self,
          nmId,
          tab.advertId,
          {
            startDate: input?.startDate,
            endDate: input?.endDate,
            status: "all",
            search: "",
            sortKey: "spend",
            sortDirection: "desc",
            page: 1,
            pageSize: 5000,
          },
        ).catch(() => null);
        return [String(tab.advertId), table] as const;
      }),
    );
    for (const [advertIdStr, table] of tableEntries) {
      if (table) clusterTables[advertIdStr] = table;
    }
  } else if (workspace.initialClusterTable) {
    // Fallback: workspace has no campaignTabs but has an initial table (edge case).
    clusterTables[String(workspace.initialClusterTable.advertId)] =
      workspace.initialClusterTable as unknown as ClusterTable;
  }

  return { workspace, clusterTables } as ProductAdvertisingWorkspaceBundleResponse;
}

function createEmptyWorkspaceClusterQueriesSnapshot() {
  return {
    checkedAt: new Date().toISOString(),
    queries: [],
  };
}

export async function getProductAdvertisingWorkspaceClusterTable(
  self: WbClustersSnapshotReadContext,
  nmId: number,
  advertId: number,
  input?: {
    startDate?: string;
    endDate?: string;
    status?: "all" | "active" | "excluded";
    search?: string;
    numericFilters?: string;
    sortKey?: string;
    sortDirection?: string;
    page?: number;
    pageSize?: number;
  },
) {

  const currentPeriod =
    input?.startDate && input?.endDate
      ? self.normalizeAdvertisingSheetJamRange(input.startDate, input.endDate)
      : null;

  // The early "return pending when PATH B in-flight" check was removed. The SQL
  // fast path now stores real rows in wb_product_workspace_campaign_rows before
  // PATH B starts, so resolveWorkspaceCampaignRows always finds data on the
  // second request. PATH B runs in the background with setImmediate yields and
  // overwrites with richer data (querySearchIndex, exact canonical counts) when done.

  let storedRows: Awaited<ReturnType<typeof self.productWorkspaceSnapshotResolver.resolveWorkspaceCampaignRows>> | null;
  try {
    storedRows = await self.productWorkspaceSnapshotResolver.resolveWorkspaceCampaignRows({
      nmId,
      advertId,
      currentPeriod,
      schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
    });
  } catch (error) {
    if (error instanceof ServiceUnavailableException) {
      storedRows = null;
    } else {
      throw error;
    }
  }
  if (!storedRows) {
    // SQL fast path: compute cluster rows directly from DB aggregations in < 500 ms.
    // Runs without PATH B. querySearchIndex is built separately from DB in < 100 ms
    // and included so the frontend can do local search immediately.
    if (currentPeriod) {
      const sqlPayload = await self.productAdvertisingReadRepository
        .getWorkspaceClusterRowsSQL(nmId, advertId, currentPeriod)
        .catch(() => null);

      if (sqlPayload !== null) {
        // Save to DB so next resolveWorkspaceCampaignRows call hits stored rows instantly.
        void self.productWorkspaceSnapshotResolver
          .saveWorkspaceCampaignRows({
            nmId,
            startDate: currentPeriod.start,
            endDate: currentPeriod.end,
            schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
            advertId,
            payload: sqlPayload,
          })
          .catch(() => null);

        // Attach query search index so the frontend can filter locally without PATH B.
        const querySearchIndex = await getOrBuildQuerySearchIndex(self, nmId, advertId);
        const snapshotWithIndex = { ...sqlPayload, querySearchIndex };

        const sqlTableResponse = self.productAdvertisingWorkspaceReadService.buildClusterTableResponse({
          nmId,
          snapshot: snapshotWithIndex,
          advertId,
          status: input?.status ?? "all",
          search: input?.search ?? "",
          numericFilters: input?.numericFilters,
          sortKey:
            (input?.sortKey as ProductAdvertisingWorkspaceClusterTableResponse["sort"]["key"] | undefined) ??
            "spend",
          sortDirection:
            (input?.sortDirection as
              | ProductAdvertisingWorkspaceClusterTableResponse["sort"]["direction"]
              | undefined) ?? "desc",
          page: input?.page ?? 1,
          pageSize: input?.pageSize ?? 200,
        });

        const sqlFastPathResponse: ProductAdvertisingWorkspaceClusterTableResponse = {
          ...sqlTableResponse,
          readiness: {
            scope: "cluster_table",
            status: "ready",
            source: "workspace_snapshot",
            materializationStatus: "materialized",
          },
        };

        return sqlFastPathResponse;
      }
    }

    // No date range: load the latest persisted DB snapshot (fast DB lookup, no PATH B).
    if (!currentPeriod) {
      const fallbackSheet = await self.productAdvertisingSnapshotResolver.resolve({
        nmId,
        currentPeriod: null,
        schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
      });
      const fallbackResponse = buildProductAdvertisingWorkspaceClusterTableResponse({
        sheet: fallbackSheet,
        advertId,
        status: input?.status ?? "all",
        search: input?.search ?? "",
        numericFilters: self.productAdvertisingWorkspaceReadService.normalizeWorkspaceClusterNumericFilters(
          input?.numericFilters,
        ),
        sortKey:
          (input?.sortKey as
            | ProductAdvertisingWorkspaceClusterTableResponse["sort"]["key"]
            | undefined) ?? "spend",
        sortDirection:
          (input?.sortDirection as
            | ProductAdvertisingWorkspaceClusterTableResponse["sort"]["direction"]
            | undefined) ?? "desc",
        page: input?.page ?? 1,
        pageSize: input?.pageSize ?? 200,
      });
      return fallbackResponse;
    }

    // No cluster data yet for this campaign/period (campaign was just created or
    // the first sync has not run yet). Return an empty pending table — the frontend
    // will retry and pick up real data after the next sync cycle.
    return {
      ...self.productAdvertisingWorkspaceReadService.buildClusterTableResponse({
        nmId,
        snapshot: {
          checkedAt: new Date().toISOString(),
          rows: [],
          filterCounts: { all: 0, active: 0, excluded: 0 },
          querySearchIndex: {},
        },
        advertId,
        status: "all",
        search: "",
        sortKey:
          (input?.sortKey as ProductAdvertisingWorkspaceClusterTableResponse["sort"]["key"] | undefined) ??
          "spend",
        sortDirection:
          (input?.sortDirection as
            | ProductAdvertisingWorkspaceClusterTableResponse["sort"]["direction"]
            | undefined) ?? "desc",
        page: input?.page ?? 1,
        pageSize: input?.pageSize ?? 200,
      }),
      readiness: {
        scope: "cluster_table",
        status: "materialization_pending",
        source: "sql_direct",
        materializationStatus: "pending",
      },
    } as ProductAdvertisingWorkspaceClusterTableResponse;
  }

  // storedRows now always comes from SQL (resolveWorkspaceCampaignRows always uses
  // the SQL fast path). SQL reads sourceKind/isActive from wb_clusters +
  // wb_cluster_actions override and bids from wb_cluster_bids — always fresh.
  // No bid merge or snapshot compat layer needed.
  const querySearchIndex = await getOrBuildQuerySearchIndex(self, nmId, advertId);
  const snapshotForResponse = { ...storedRows.payload, querySearchIndex };
  const searchStr = input?.search ?? "";

  const storedRowsResponse = {
    ...self.productAdvertisingWorkspaceReadService.buildClusterTableResponse({
      nmId,
      snapshot: snapshotForResponse,
      advertId,
      status: input?.status ?? "all",
      search: searchStr,
      numericFilters: input?.numericFilters,
      sortKey:
        (input?.sortKey as
          | ProductAdvertisingWorkspaceClusterTableResponse["sort"]["key"]
          | undefined) ?? "spend",
      sortDirection:
        (input?.sortDirection as
          | ProductAdvertisingWorkspaceClusterTableResponse["sort"]["direction"]
          | undefined) ?? "desc",
      page: input?.page ?? 1,
      pageSize: input?.pageSize ?? 200,
    }),
    readiness: {
      scope: "cluster_table",
      status: "ready",
      source: "workspace_snapshot",
      materializationStatus: "materialized",
    },
  } as ProductAdvertisingWorkspaceClusterTableResponse;
  return storedRowsResponse;
}

export async function getProductAdvertisingWorkspaceClusterQueries(
  self: WbClustersSnapshotReadContext,
  nmId: number,
  advertId: number,
  input: {
    clusterKey?: string;
    clusterName?: string;
    startDate?: string;
    endDate?: string;
    sortKey?: string;
    sortDirection?: string;
  },
) {
  const currentPeriod =
    input.startDate && input.endDate
      ? self.normalizeAdvertisingSheetJamRange(input.startDate, input.endDate)
      : null;
  const clusterKey = input.clusterKey?.trim()
    ? input.clusterKey.trim()
    : input.clusterName?.trim()
      ? `${advertId}:${self.normalizeAdvertisingText(input.clusterName)}`
      : null;
  const storedQueries = clusterKey
    ? await self.productWorkspaceSnapshotResolver.resolveWorkspaceClusterQueries({
        nmId,
        advertId,
        clusterKey,
        currentPeriod,
        schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
      })
    : null;
  if (clusterKey && !storedQueries) {
    // SQL fast path: read queries directly from wb_cabinet_cluster_queries + wb_cluster_queries.
    // Indexed by (nm_id, advert_id, normalized_cluster_name) — expected latency < 100 ms.
    // The normalizedClusterName is the part of clusterKey after the advertId prefix.
    const normalizedClusterName = clusterKey.startsWith(`${advertId}:`)
      ? clusterKey.slice(`${advertId}:`.length)
      : input.clusterName
        ? self.normalizeAdvertisingText(input.clusterName)
        : null;

    if (normalizedClusterName) {
      const sqlSnapshot = await self.productAdvertisingReadRepository
        .getWorkspaceClusterQueriesSQL(nmId, advertId, normalizedClusterName)
        .catch(() => null);

      if (sqlSnapshot !== null) {
        return {
          ...self.productAdvertisingWorkspaceReadService.buildClusterQueriesResponse({
            nmId,
            snapshot: sqlSnapshot,
            advertId,
            clusterKey,
            clusterName: input.clusterName ?? normalizedClusterName,
            sortKey:
              (input.sortKey as ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["key"] | undefined) ??
              "monthlyFrequency",
            sortDirection:
              (input.sortDirection as
                | ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["direction"]
                | undefined) ?? "desc",
            normalizeAdvertisingText: (value: string) => self.normalizeAdvertisingText(value),
          }),
          readiness: {
            scope: "cluster_queries",
            status: "ready",
            source: "workspace_snapshot",
            materializationStatus: "materialized",
          },
        };
      }
    }

    // SQL fast path failed: fall back to PATH B sheet (legacy path).
    const fallbackSheet = await self.productAdvertisingSnapshotResolver.resolve({
      nmId,
      currentPeriod,
      schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
    });
    return buildProductAdvertisingWorkspaceClusterQueriesResponse({
      sheet: fallbackSheet,
      advertId,
      clusterKey,
      clusterName: input.clusterName,
      sortKey:
        (input.sortKey as ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["key"] | undefined) ??
        "spend",
      sortDirection:
        (input.sortDirection as
          | ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["direction"]
          | undefined) ?? "desc",
    });
  }

  return {
    ...self.productAdvertisingWorkspaceReadService.buildClusterQueriesResponse({
      nmId,
      snapshot: storedQueries?.payload ?? createEmptyWorkspaceClusterQueriesSnapshot(),
      advertId,
      clusterKey: clusterKey ?? undefined,
      clusterName: storedQueries?.clusterName ?? input.clusterName ?? undefined,
      sortKey:
        (input.sortKey as ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["key"] | undefined) ??
        "spend",
      sortDirection:
        (input.sortDirection as
          | ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["direction"]
          | undefined) ?? "desc",
      normalizeAdvertisingText: (value: string) => self.normalizeAdvertisingText(value),
    }),
    readiness: {
      scope: "cluster_queries",
      status: "ready",
      source: clusterKey ? "workspace_snapshot" : "sheet_snapshot",
      materializationStatus: clusterKey ? "materialized" : "fallback_sheet",
    },
  };
}

export async function getProductAdvertisingSheetBundle(
  self: WbClustersSnapshotReadContext,
  input: {
    nmIds: number[];
    startDate: string;
    endDate: string;
  },
): Promise<ProductAdvertisingSheetBundleResponse> {
  const currentPeriod = self.normalizeAdvertisingSheetJamRange(input.startDate, input.endDate);
  const uniqueNmIds = Array.from(
    new Set(input.nmIds.filter((value) => Number.isInteger(value) && value > 0)),
  );

  const sheets = await self.productAdvertisingSnapshotResolver.resolveMany({
    nmIds: uniqueNmIds,
    currentPeriod,
    schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
  });

  return {
    checkedAt: new Date().toISOString(),
    range: {
      startDate: currentPeriod.start,
      endDate: currentPeriod.end,
    },
    sheets,
  };
}

export function withEmptyJamMetrics(self: WbClustersSnapshotReadContext, sheet: unknown) {
  return withEmptyJamMetricsValue(sheet as ProductAdvertisingSheetResponse);
}

export async function enrichProductAdvertisingSheetWithJam(
  self: WbClustersSnapshotReadContext,
  sheet: ProductAdvertisingSheetResponse,
  nmId: number,
  currentPeriod: { start: string; end: string },
  allowLiveFetch = false,
): Promise<ProductAdvertisingSheetResponse> {
  const overlay = await self.getOrLoadProductAdvertisingSheetJamOverlay(
    sheet,
    nmId,
    currentPeriod,
    allowLiveFetch,
  );

  return enrichProductAdvertisingSheetWithJamValue({
    sheet,
    overlay,
    normalizeAdvertisingText: (value) => self.normalizeAdvertisingText(value),
  });
}

export async function getOrLoadProductAdvertisingSheetSnapshot(
  self: WbClustersSnapshotReadContext,
  nmId: number,
  currentPeriod: { start: string; end: string },
): Promise<ProductAdvertisingSheetResponse> {
  const cacheKey = buildProductAdvertisingSheetCacheKey({
    nmId,
    currentPeriod,
    cacheVersion: self.productAdvertisingSheetCacheVersion.get(nmId) ?? 0,
  });
  const cachedValue = self.productAdvertisingSheetSnapshotCache.get(cacheKey);
  if (cachedValue && cachedValue.expiresAtMs > Date.now()) {
    return cachedValue.value;
  }

  const pendingValue = self.productAdvertisingSheetSnapshotInFlight.get(cacheKey);
  if (pendingValue) {
    return pendingValue;
  }

  const loadPromise = self.productAdvertisingSnapshotResolver.resolve({
    nmId,
    currentPeriod,
    schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
  });
  self.productAdvertisingSheetSnapshotInFlight.set(cacheKey, loadPromise);

  try {
    const value: ProductAdvertisingSheetResponse = await loadPromise;
    self.productAdvertisingSheetSnapshotCache.set(cacheKey, {
      expiresAtMs: Date.now() + self.resolveProductAdvertisingSheetSnapshotCacheTtlMs(value),
      value,
    });
    return value;
  } finally {
    self.productAdvertisingSheetSnapshotInFlight.delete(cacheKey);
  }
}

export async function materializeProductAdvertisingSheetSnapshot(
  self: WbClustersSnapshotReadContext,
  nmId: number,
  currentPeriod: { start: string; end: string },
) {
  return self.productAdvertisingSnapshotMaterializer.materializeExactSnapshot({
    nmId,
    currentPeriod,
    schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
    buildReadySheet: async () => {
      const sheet = self.withEmptyJamMetrics(
        await self.productAdvertisingReadRepository.getProductAdvertisingSheet(
          nmId,
          currentPeriod,
        ),
      );
      // DB-only: enrich from stored per-day snapshots. No live WB call.
      // If the day is not yet in DB, JAM rows will be empty until the next sync.
      const enrichedSheet = await self.enrichProductAdvertisingSheetWithJam(
        sheet,
        nmId,
        currentPeriod,
      );
      if (
        enrichedSheet.summary.queryCoverageStatus !== "ready" &&
        enrichedSheet.summary.queryCoverageStatus !== "no-clusters"
      ) {
        self.logger.warn(
          `Product advertising snapshot for nm ${nmId} (${currentPeriod.start}..${currentPeriod.end}) is ready but query coverage is ${enrichedSheet.summary.queryCoverageStatus}: ${enrichedSheet.summary.queryCoverageReason ?? "no reason provided"}.`,
        );
      }
      return enrichedSheet;
    },
  });
}

export async function getOrLoadProductAdvertisingSheetJamOverlay(
  self: WbClustersSnapshotReadContext,
  sheet: ProductAdvertisingSheetResponse,
  nmId: number,
  currentPeriod: { start: string; end: string },
  allowLiveFetch: boolean,
) {
  const cacheKey = `${buildProductAdvertisingSheetCacheKey({
    nmId,
    currentPeriod,
    cacheVersion: self.productAdvertisingSheetCacheVersion.get(nmId) ?? 0,
  })}:${allowLiveFetch ? "materialize" : "stored"}`;
  const cachedValue = self.productAdvertisingSheetJamCache.get(cacheKey);
  if (cachedValue && cachedValue.expiresAtMs > Date.now()) {
    return cachedValue.value;
  }

  const pendingValue = self.productAdvertisingSheetJamInFlight.get(cacheKey);
  if (pendingValue) {
    return pendingValue;
  }

  const loadPromise = self.buildProductAdvertisingSheetJamOverlay(
    sheet,
    nmId,
    currentPeriod,
    allowLiveFetch,
  );
  self.productAdvertisingSheetJamInFlight.set(cacheKey, loadPromise);

  try {
    const value = await loadPromise;
    self.productAdvertisingSheetJamCache.set(cacheKey, {
      expiresAtMs: Date.now() + self.productAdvertisingSheetJamCacheTtlMs,
      value,
    });
    return value;
  } finally {
    self.productAdvertisingSheetJamInFlight.delete(cacheKey);
  }
}

// Кешированная сборка read model из daily stats.
// Кеш инвалидируется при updateCacheVersion (через invalidateProductAdvertisingSheetCaches)
// и по TTL 10 мин. Деduplicates одновременные запросы через in-flight Map.

export function invalidateProductAdvertisingSheetCaches(self: WbClustersSnapshotReadContext, nmId: number) {
  invalidateProductAdvertisingSheetCachesValue({
    nmId,
    versionMap: self.productAdvertisingSheetCacheVersion,
    caches: [
      self.productAdvertisingSheetJamCache as Map<string, unknown>,
      self.productAdvertisingSheetSnapshotCache as Map<string, unknown>,
      self.productAdvertisingSheetReadModelCache as Map<string, unknown>,
    ],
  });
  // querySearchIndex is keyed by nmId:advertId:v{version}; since the version just
  // incremented above, old entries are now stale. Proactively delete them to free memory.
  const prefix = `${nmId}:`;
  for (const key of self.querySearchIndexCache.keys()) {
    if (key.startsWith(prefix)) {
      self.querySearchIndexCache.delete(key);
    }
  }
}

export function resolveProductAdvertisingSheetSnapshotCacheTtlMs(
  self: WbClustersSnapshotReadContext,
  value: { snapshot: { status: string } },
) {
  if (value.snapshot.status === "missing" || value.snapshot.status === "failed") {
    return 5_000;
  }

  return self.productAdvertisingSheetSnapshotCacheTtlMs;
}

export async function buildProductAdvertisingSheetJamOverlay(
  self: WbClustersSnapshotReadContext,
  sheet: ProductAdvertisingSheetResponse,
  nmId: number,
  currentPeriod: { start: string; end: string },
  allowLiveFetch: boolean,
) {
  const searchTexts: SearchQueryTextView[] = await self.loadProductAdvertisingSheetSearchTextsRange(
    nmId,
    currentPeriod,
    allowLiveFetch,
  );
  const uniqueQueries = Array.from(
    new Set(searchTexts.map((item) => item.text.trim()).filter((value) => value.length > 0)),
  );
  const lookupMatches =
    uniqueQueries.length > 0
      ? await self.wbClustersRepository.lookupProductClusters(nmId, uniqueQueries)
      : [];
  return buildProductAdvertisingSheetJamOverlayValue({
    sheet,
    searchTexts,
    lookupMatches,
    normalizeAdvertisingText: (value) => self.normalizeAdvertisingText(value),
  });
}
