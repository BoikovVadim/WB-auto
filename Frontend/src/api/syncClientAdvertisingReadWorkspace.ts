import type { ProductAdvertisingSheetRequestInput } from "./productAdvertisingSheetIdentity";
import { cacheProductWorkspace, getCachedProductWorkspace } from "./productWorkspaceCache";
import {
  buildProductWorkspaceClusterQueriesCacheKey,
  buildProductWorkspaceClusterTableCacheKey,
  cacheProductWorkspaceClusterQueries,
  cacheProductWorkspaceClusterTable,
  getCachedProductWorkspaceClusterTable,
  getClusterBundleFromSession,
  persistClusterBundleToSession,
} from "./productWorkspaceSlicesCache";
import type {
  ProductAdvertisingWorkspaceBundleResponse,
  ProductAdvertisingWorkspaceClusterNumericFilters,
  ProductAdvertisingWorkspaceClusterSortDirection,
  ProductAdvertisingWorkspaceClusterSortKey,
  ProductAdvertisingWorkspaceClusterStatusFilter,
  ProductAdvertisingWorkspaceClusterQueriesResponse,
  ProductAdvertisingWorkspaceClusterTableResponse,
  ProductAdvertisingWorkspaceResponse,
} from "./syncClientTypes";
import {
  assertProductAdvertisingWorkspaceClusterTableResponse,
  assertProductAdvertisingWorkspaceClusterQueriesResponse,
  assertProductAdvertisingWorkspaceResponse,
} from "./syncClientValidators";
import { advertisingApiTimeoutMs, apiClient } from "./syncClientHttp";
import { isRecord } from "./syncClientValidatorUtils";

type WorkspaceRequestSource = "user" | "prefetch";
type WorkspaceRequestInFlightEntry = {
  source: WorkspaceRequestSource;
  promise: Promise<ProductAdvertisingWorkspaceResponse>;
};

const productWorkspaceRequestInFlight = new Map<string, WorkspaceRequestInFlightEntry>();
const productWorkspaceBundleRequestInFlight =
  new Map<string, Promise<ProductAdvertisingWorkspaceBundleResponse>>();
const productWorkspaceClusterTableRequestInFlight =
  new Map<string, Promise<ProductAdvertisingWorkspaceClusterTableResponse>>();
const productWorkspaceClusterQueriesRequestInFlight =
  new Map<string, Promise<ProductAdvertisingWorkspaceClusterQueriesResponse>>();

export function getEmptyClusterNumericFilters(): ProductAdvertisingWorkspaceClusterNumericFilters {
  return {
    jamFrequency: { min: null, max: null },
    jamClicks: { min: null, max: null },
    jamAddToCart: { min: null, max: null },
    jamOrders: { min: null, max: null },
    jamAvgPosition: { min: null, max: null },
    jamCtc: { min: null, max: null },
    jamCto: { min: null, max: null },
    monthlyFrequency: { min: null, max: null },
    bid: { min: null, max: null },
    views: { min: null, max: null },
    clicks: { min: null, max: null },
    ctr: { min: null, max: null },
    addToCart: { min: null, max: null },
    ctc: { min: null, max: null },
    orders: { min: null, max: null },
    cto: { min: null, max: null },
    avgPosition: { min: null, max: null },
    cpc: { min: null, max: null },
    cpm: { min: null, max: null },
    cpo: { min: null, max: null },
    viewToOrder: { min: null, max: null },
    spend: { min: null, max: null },
  };
}

export async function fetchProductAdvertisingWorkspace(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput,
  options?: {
    source?: WorkspaceRequestSource;
  },
) {
  const requestKey = [
    "workspace",
    nmId,
    input?.startDate ?? "none",
    input?.endDate ?? "none",
  ].join(":");
  const requestSource = options?.source ?? "user";
  const inFlightRequest = productWorkspaceRequestInFlight.get(requestKey);
  if (inFlightRequest) {
    // If a background prefetch got stuck, do not block the interactive open.
    // Start a fresh user request so product open remains responsive.
    const shouldReuseInFlight =
      !(requestSource === "user" && inFlightRequest.source === "prefetch");
    if (shouldReuseInFlight) {
      return inFlightRequest.promise;
    }
  }

  const requestPromise = apiClient
    .get<unknown>(`/wb-clusters/products/${nmId}/workspace`, {
      timeout: advertisingApiTimeoutMs,
      params: input
        ? {
            startDate: input.startDate,
            endDate: input.endDate,
          }
        : undefined,
    })
    .then((response) => {
      assertProductAdvertisingWorkspaceResponse(response.data);
      cacheProductWorkspace(nmId, input, response.data);

      // Seed ALL campaign tables from per-key sessionStorage into memory so
      // getCachedProductWorkspaceClusterTable returns a hit without waiting for
      // the background prefetch (makes isTableRefreshing = false on refresh).
      const campaignTabs = response.data.campaignTabs ?? [];
      for (const tab of campaignTabs) {
        const tabKey = buildProductWorkspaceClusterTableCacheKey({
          nmId,
          advertId: tab.advertId,
          requestInput: input,
          search: "",
          clusterNameSearch: "",
          status: "all",
          numericFilters: getEmptyClusterNumericFilters(),
          page: 1,
          pageSize: 5000,
        });
        // getCachedProductWorkspaceClusterTable already checks session on miss
        // and warms memory — one call is enough to seed the memory cache.
        getCachedProductWorkspaceClusterTable(tabKey);
      }

      if (response.data.initialClusterTable) {
        const initialClusterTableKey = buildProductWorkspaceClusterTableCacheKey({
          nmId,
          advertId: response.data.initialClusterTable.advertId,
          requestInput: input,
          search: "",
          clusterNameSearch: "",
          status: "all",
          numericFilters: getEmptyClusterNumericFilters(),
          page: 1,
          pageSize: response.data.initialClusterTable.pagination.pageSize,
        });
        cacheProductWorkspaceClusterTable(
          initialClusterTableKey,
          response.data.initialClusterTable,
        );
      }
      return response.data;
    })
    .finally(() => {
      const current = productWorkspaceRequestInFlight.get(requestKey);
      if (current?.promise === requestPromise) {
        productWorkspaceRequestInFlight.delete(requestKey);
      }
    });

  productWorkspaceRequestInFlight.set(requestKey, {
    source: requestSource,
    promise: requestPromise,
  });
  return requestPromise;
}

// Fetches workspace + ALL campaign cluster tables in a SINGLE round-trip.
// Populates the same per-table and workspace memory caches used by the
// individual endpoints, so all downstream hooks immediately read from cache.
// Also persists the bundle to sessionStorage so the next visit (after
// back-navigation or page refresh within the same tab) is truly instant.
export async function fetchProductAdvertisingWorkspaceBundle(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput,
): Promise<ProductAdvertisingWorkspaceBundleResponse> {
  const requestKey = [
    "workspace-bundle",
    nmId,
    input?.startDate ?? "none",
    input?.endDate ?? "none",
  ].join(":");

  const inFlightRequest = productWorkspaceBundleRequestInFlight.get(requestKey);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  // If workspace already in memory AND session bundle matches → no network call.
  const cachedWorkspace = getCachedProductWorkspace(nmId, input);
  if (cachedWorkspace && input?.startDate && input?.endDate) {
    const sessionTables = getClusterBundleFromSession(nmId, input.startDate, input.endDate);
    if (sessionTables && Object.keys(sessionTables).length > 0) {
      // Warm memory caches from session so all hooks can read synchronously.
      for (const [advertIdStr, table] of Object.entries(sessionTables)) {
        const tableKey = buildProductWorkspaceClusterTableCacheKey({
          nmId,
          advertId: Number(advertIdStr),
          requestInput: input,
          search: "",
          clusterNameSearch: "",
          status: "all",
          numericFilters: getEmptyClusterNumericFilters(),
          page: table.pagination.page,
          pageSize: table.pagination.pageSize,
        });
        cacheProductWorkspaceClusterTable(tableKey, table);
      }
      return { workspace: cachedWorkspace, clusterTables: sessionTables };
    }

    // Session bundle is for a different product but the memory cache may already
    // hold all campaign tables for this product (populated during the previous visit
    // in the same tab session). If every campaignTab has a matching memory entry we
    // can return immediately without a round-trip.
      const campaignTabs = cachedWorkspace.campaignTabs ?? [];
    if (campaignTabs.length > 0) {
      const memoryTables: Record<string, ProductAdvertisingWorkspaceClusterTableResponse> = {};
      for (const tab of campaignTabs) {
        const tableKey = buildProductWorkspaceClusterTableCacheKey({
          nmId,
          advertId: tab.advertId,
          requestInput: input,
          search: "",
          clusterNameSearch: "",
          status: "all",
          numericFilters: getEmptyClusterNumericFilters(),
          page: 1,
          pageSize: 5000,
        });
        const cached = getCachedProductWorkspaceClusterTable(tableKey);
        if (!cached) break;
        memoryTables[String(tab.advertId)] = cached;
      }
      if (Object.keys(memoryTables).length === campaignTabs.length) {
        // All campaign tables found in memory — persist to session for next reload
        // and return without hitting the network.
        persistClusterBundleToSession(nmId, input.startDate, input.endDate, memoryTables);
        return { workspace: cachedWorkspace, clusterTables: memoryTables };
      }
    }
  }

  const requestPromise = apiClient
    .get<unknown>(`/wb-clusters/products/${nmId}/workspace-bundle`, {
      timeout: Math.max(advertisingApiTimeoutMs, 120_000),
      params: input
        ? { startDate: input.startDate, endDate: input.endDate }
        : undefined,
    })
    .then((response) => {
      if (!isRecord(response.data)) {
        throw new Error("workspace-bundle response is not an object");
      }
      const data = response.data as unknown as ProductAdvertisingWorkspaceBundleResponse;
      assertProductAdvertisingWorkspaceResponse(data.workspace);

      // clusterTables must be a plain object map keyed by advertId. A non-object
      // (array, string, null) would make Object.entries below yield garbage keys
      // and NaN cache keys without throwing, so reject it explicitly.
      if (data.clusterTables != null && !isRecord(data.clusterTables)) {
        throw new Error("workspace-bundle clusterTables is not an object map");
      }

      // Cache workspace (memory + sessionStorage).
      cacheProductWorkspace(nmId, input, data.workspace);

      // Cache each cluster table in memory with canonical key.
      for (const [advertIdStr, table] of Object.entries(data.clusterTables ?? {})) {
        assertProductAdvertisingWorkspaceClusterTableResponse(table);
        const tableKey = buildProductWorkspaceClusterTableCacheKey({
          nmId,
          advertId: Number(advertIdStr),
          requestInput: input,
          search: "",
          clusterNameSearch: "",
          status: "all",
          numericFilters: getEmptyClusterNumericFilters(),
          page: table.pagination.page,
          pageSize: table.pagination.pageSize,
        });
        cacheProductWorkspaceClusterTable(tableKey, table);
      }

      // Persist bundle to sessionStorage for instant second visit.
      if (input?.startDate && input?.endDate) {
        persistClusterBundleToSession(
          nmId,
          input.startDate,
          input.endDate,
          data.clusterTables ?? {},
        );
      }

      return data;
    })
    .finally(() => {
      productWorkspaceBundleRequestInFlight.delete(requestKey);
    });

  productWorkspaceBundleRequestInFlight.set(requestKey, requestPromise);
  return requestPromise;
}

export async function fetchProductAdvertisingWorkspaceClusterTable(input: {
  nmId: number;
  advertId: number;
  requestInput?: ProductAdvertisingSheetRequestInput | null;
  search?: string;
  clusterNameSearch?: string;
  status?: ProductAdvertisingWorkspaceClusterStatusFilter;
  numericFilters?: ProductAdvertisingWorkspaceClusterNumericFilters;
  sortKey?: ProductAdvertisingWorkspaceClusterSortKey;
  sortDirection?: ProductAdvertisingWorkspaceClusterSortDirection;
  page?: number;
  pageSize?: number;
}): Promise<ProductAdvertisingWorkspaceClusterTableResponse> {
  const requestKey = buildProductWorkspaceClusterTableCacheKey(input);
  const inFlightRequest = productWorkspaceClusterTableRequestInFlight.get(requestKey);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const requestPromise = apiClient
    .get<unknown>(
      `/wb-clusters/products/${input.nmId}/campaigns/${input.advertId}/workspace-cluster-table`,
      {
        // Кластерная таблица может содержать 400+ кластеров → бэкенд агрегирует
        // много данных. Увеличиваем таймаут до 120 сек чтобы не получать ложный
        // таймаут для крупных кампаний.
        timeout: Math.max(advertisingApiTimeoutMs, 120_000),
        params: {
          startDate: input.requestInput?.startDate,
          endDate: input.requestInput?.endDate,
          search: input.search?.trim() ?? "",
          clusterNameSearch: input.clusterNameSearch?.trim() ?? "",
          status: input.status ?? ("all" satisfies ProductAdvertisingWorkspaceClusterStatusFilter),
          numericFilters: JSON.stringify(input.numericFilters ?? getEmptyClusterNumericFilters()),
          sortKey: input.sortKey ?? ("spend" satisfies ProductAdvertisingWorkspaceClusterSortKey),
          sortDirection:
            input.sortDirection ?? ("desc" satisfies ProductAdvertisingWorkspaceClusterSortDirection),
          page: input.page ?? 1,
          pageSize: input.pageSize ?? 200,
        },
      },
    )
    .then((response) => {
      assertProductAdvertisingWorkspaceClusterTableResponse(response.data);
      cacheProductWorkspaceClusterTable(requestKey, response.data);
      return response.data;
    })
    .finally(() => {
      productWorkspaceClusterTableRequestInFlight.delete(requestKey);
    });

  productWorkspaceClusterTableRequestInFlight.set(requestKey, requestPromise);
  return requestPromise;
}

export function isProductWorkspaceClusterTableRequestInFlight(key: string): boolean {
  return productWorkspaceClusterTableRequestInFlight.has(key);
}

export function isProductWorkspaceBundleRequestInFlight(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput | null,
): boolean {
  const requestKey = [
    "workspace-bundle",
    nmId,
    input?.startDate ?? "none",
    input?.endDate ?? "none",
  ].join(":");
  return productWorkspaceBundleRequestInFlight.has(requestKey);
}

export async function fetchProductAdvertisingWorkspaceClusterQueries(input: {
  nmId: number;
  advertId: number;
  clusterKey: string;
  clusterName?: string;
  requestInput?: ProductAdvertisingSheetRequestInput | null;
  sortKey?: ProductAdvertisingWorkspaceClusterSortKey;
  sortDirection?: ProductAdvertisingWorkspaceClusterSortDirection;
}): Promise<ProductAdvertisingWorkspaceClusterQueriesResponse> {
  const requestKey = buildProductWorkspaceClusterQueriesCacheKey(input);
  const inFlightRequest = productWorkspaceClusterQueriesRequestInFlight.get(requestKey);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const requestPromise = apiClient
    .get<unknown>(
      `/wb-clusters/products/${input.nmId}/campaigns/${input.advertId}/workspace-cluster-queries`,
      {
        timeout: advertisingApiTimeoutMs,
        params: {
          clusterKey: input.clusterKey,
          clusterName: input.clusterName,
          startDate: input.requestInput?.startDate,
          endDate: input.requestInput?.endDate,
          sortKey: input.sortKey ?? ("spend" satisfies ProductAdvertisingWorkspaceClusterSortKey),
          sortDirection:
            input.sortDirection ?? ("desc" satisfies ProductAdvertisingWorkspaceClusterSortDirection),
        },
      },
    )
    .then((response) => {
      assertProductAdvertisingWorkspaceClusterQueriesResponse(response.data);
      cacheProductWorkspaceClusterQueries(requestKey, response.data);
      return response.data;
    })
    .finally(() => {
      productWorkspaceClusterQueriesRequestInFlight.delete(requestKey);
    });

  productWorkspaceClusterQueriesRequestInFlight.set(requestKey, requestPromise);
  return requestPromise;
}
