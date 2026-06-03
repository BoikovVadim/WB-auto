import { ServiceUnavailableException } from "@nestjs/common";

import {
  buildProductAdvertisingSheetJamOverlay as buildProductAdvertisingSheetJamOverlayValue,
  buildProductAdvertisingSheetCacheKey,
  enrichProductAdvertisingSheetWithJam as enrichProductAdvertisingSheetWithJamValue,
  invalidateProductAdvertisingSheetCaches as invalidateProductAdvertisingSheetCachesValue,
} from "./product-advertising-sheet.snapshot";
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
import { stripHeavyUnusedSheetFields } from "./wb-clusters-read-flow.sheet-response-trim";
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
    // resolve() здесь читает снапшот, который в fallback-путях нужен с clusterQueries —
    // поэтому стрипаем копию ответа, а не результат resolve().
    return stripHeavyUnusedSheetFields(
      await self.productAdvertisingSnapshotResolver.resolve({
        nmId,
        currentPeriod: null,
        schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
      }),
    );
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
  // Keep workspace endpoint shell-only.
  // Loading initialClusterTable here can block the entire product opening path
  // because cluster rows require heavier SQL (including JAM joins).
  // Table data is fetched via dedicated table/bundle endpoints.
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
    clusterNameSearch?: string;
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
  const responseSortKey =
    (input?.sortKey as ProductAdvertisingWorkspaceClusterTableResponse["sort"]["key"] | undefined) ??
    "spend";
  const responseSortDirection =
    (input?.sortDirection as
      | ProductAdvertisingWorkspaceClusterTableResponse["sort"]["direction"]
      | undefined) ?? "desc";
  const responseStatus = input?.status ?? "all";
  const responseSearch = input?.search ?? "";
  const responseClusterNameSearch = input?.clusterNameSearch ?? "";

  if (currentPeriod) {
    try {
      const sqlRows = await self.productWorkspaceSnapshotResolver.resolveWorkspaceCampaignRows({
        nmId,
        advertId,
        currentPeriod,
        schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
      });
      const querySearchIndex = await getOrBuildQuerySearchIndex(self, nmId, advertId);

      return {
        ...self.productAdvertisingWorkspaceReadService.buildClusterTableResponse({
          nmId,
          snapshot: {
            ...sqlRows.payload,
            querySearchIndex,
          },
          advertId,
          status: responseStatus,
          search: responseSearch,
          clusterNameSearch: responseClusterNameSearch,
          numericFilters: input?.numericFilters,
          sortKey: responseSortKey,
          sortDirection: responseSortDirection,
          page: input?.page ?? 1,
          pageSize: input?.pageSize ?? 200,
        }),
        readiness: {
          scope: "cluster_table",
          status: "ready",
          source: "sql_direct",
          materializationStatus: "sql_direct",
        },
      } satisfies ProductAdvertisingWorkspaceClusterTableResponse;
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) {
        throw error;
      }
    }

    // Exact explicit range: if Postgres has no rows yet, return an exact empty shell
    // for this period instead of reviving another period or rebuilding from sheet fallback.
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
        status: responseStatus,
        search: responseSearch,
        clusterNameSearch: responseClusterNameSearch,
        numericFilters: input?.numericFilters,
        sortKey: responseSortKey,
        sortDirection: responseSortDirection,
        page: input?.page ?? 1,
        pageSize: input?.pageSize ?? 200,
      }),
      readiness: {
        scope: "cluster_table",
        status: "materialization_pending",
        source: "sql_direct",
        materializationStatus: "pending",
      },
    } satisfies ProductAdvertisingWorkspaceClusterTableResponse;
  }

  let storedRows: Awaited<
    ReturnType<typeof self.productWorkspaceSnapshotResolver.resolveWorkspaceCampaignRows>
  > | null;
  try {
    storedRows = await self.productWorkspaceSnapshotResolver.resolveWorkspaceCampaignRows({
      nmId,
      advertId,
      currentPeriod: null,
      schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
    });
  } catch (error) {
    if (error instanceof ServiceUnavailableException) {
      storedRows = null;
    } else {
      throw error;
    }
  }

  if (storedRows) {
    const querySearchIndex = await getOrBuildQuerySearchIndex(self, nmId, advertId);
    return {
      ...self.productAdvertisingWorkspaceReadService.buildClusterTableResponse({
        nmId,
        snapshot: {
          ...storedRows.payload,
          querySearchIndex,
        },
        advertId,
        status: responseStatus,
        search: responseSearch,
        clusterNameSearch: responseClusterNameSearch,
        numericFilters: input?.numericFilters,
        sortKey: responseSortKey,
        sortDirection: responseSortDirection,
        page: input?.page ?? 1,
        pageSize: input?.pageSize ?? 200,
      }),
      readiness: {
        scope: "cluster_table",
        status: "ready",
        source: "workspace_snapshot",
        materializationStatus: "materialized",
      },
    } satisfies ProductAdvertisingWorkspaceClusterTableResponse;
  }

  const fallbackSheet = await self.productAdvertisingSnapshotResolver.resolve({
    nmId,
    currentPeriod: null,
    schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
  });
  return buildProductAdvertisingWorkspaceClusterTableResponse({
    sheet: fallbackSheet,
    advertId,
    status: responseStatus,
    search: responseSearch,
    clusterNameSearch: responseClusterNameSearch,
    numericFilters: self.productAdvertisingWorkspaceReadService.normalizeWorkspaceClusterNumericFilters(
      input?.numericFilters,
    ),
    sortKey: responseSortKey,
    sortDirection: responseSortDirection,
    page: input?.page ?? 1,
    pageSize: input?.pageSize ?? 200,
  });
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
  const responseSortKey =
    (input.sortKey as ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["key"] | undefined) ??
    "spend";
  const responseSortDirection =
    (input.sortDirection as
      | ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["direction"]
      | undefined) ?? "desc";

  if (!clusterKey) {
    return {
      ...self.productAdvertisingWorkspaceReadService.buildClusterQueriesResponse({
        nmId,
        snapshot: createEmptyWorkspaceClusterQueriesSnapshot(),
        advertId,
        clusterKey: undefined,
        clusterName: input.clusterName ?? undefined,
        sortKey: responseSortKey,
        sortDirection: responseSortDirection,
        normalizeAdvertisingText: (value: string) => self.normalizeAdvertisingText(value),
      }),
      readiness: {
        scope: "cluster_queries",
        status: "ready",
        source: currentPeriod ? "sql_direct" : "sheet_snapshot",
        materializationStatus: currentPeriod ? "sql_direct" : "fallback_sheet",
      },
    };
  }

  if (currentPeriod) {
    const normalizedClusterName = clusterKey.startsWith(`${advertId}:`)
      ? clusterKey.slice(`${advertId}:`.length)
      : input.clusterName
        ? self.normalizeAdvertisingText(input.clusterName)
        : null;
    const sqlSnapshot = normalizedClusterName
      ? await self.productAdvertisingReadRepository
          .getWorkspaceClusterQueriesSQL(nmId, advertId, normalizedClusterName, currentPeriod)
          .catch(() => null)
      : null;

    return {
      ...self.productAdvertisingWorkspaceReadService.buildClusterQueriesResponse({
        nmId,
        snapshot: sqlSnapshot ?? createEmptyWorkspaceClusterQueriesSnapshot(),
        advertId,
        clusterKey,
        clusterName: input.clusterName ?? normalizedClusterName ?? clusterKey,
        sortKey: responseSortKey,
        sortDirection: responseSortDirection,
        normalizeAdvertisingText: (value: string) => self.normalizeAdvertisingText(value),
      }),
      readiness: {
        scope: "cluster_queries",
        status: "ready",
        source: "sql_direct",
        materializationStatus: "sql_direct",
      },
    };
  }

  const storedQueries = await self.productWorkspaceSnapshotResolver.resolveWorkspaceClusterQueries({
    nmId,
    advertId,
    clusterKey,
    currentPeriod: null,
    schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
  });

  return {
    ...self.productAdvertisingWorkspaceReadService.buildClusterQueriesResponse({
      nmId,
      snapshot: storedQueries?.payload ?? createEmptyWorkspaceClusterQueriesSnapshot(),
      advertId,
      clusterKey,
      clusterName: storedQueries?.clusterName ?? input.clusterName ?? clusterKey,
      sortKey: responseSortKey,
      sortDirection: responseSortDirection,
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

  const sheets = await Promise.all(
    uniqueNmIds.map((nmId) => getOrLoadProductAdvertisingSheetSnapshot(self, nmId, currentPeriod)),
  );

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

  const loadPromise = (async () => {
    const sheet = self.withEmptyJamMetrics(
      await self.productAdvertisingReadRepository.getProductAdvertisingSheet(
        nmId,
        currentPeriod,
      ),
    );
    const enrichedSheet = await self.enrichProductAdvertisingSheetWithJam(
      sheet,
      nmId,
      currentPeriod,
    );
    return self.productAdvertisingSnapshotResolver.attachLiveMetadata(
      enrichedSheet,
      currentPeriod,
      "ready",
    );
  })();
  self.productAdvertisingSheetSnapshotInFlight.set(cacheKey, loadPromise);

  try {
    // loadPromise уже прогнал JAM-enrich/attachLiveMetadata (им clusterQueries нужен);
    // дальше лист в ответе не нужен — срезаем до кэша, чтобы и payload, и серверный
    // in-memory кэш (BoundedLruMap) не держали до 216k строк на «горячий» товар.
    const value: ProductAdvertisingSheetResponse = stripHeavyUnusedSheetFields(
      await loadPromise,
    );
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
