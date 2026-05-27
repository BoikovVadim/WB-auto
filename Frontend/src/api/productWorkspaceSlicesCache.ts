import {
  normalizeProductAdvertisingSheetRequestInput,
  type ProductAdvertisingSheetRequestInput,
} from "./productAdvertisingSheetIdentity";
import type {
  ProductAdvertisingWorkspaceClusterNumericFilters,
  ProductAdvertisingWorkspaceClusterSortDirection,
  ProductAdvertisingWorkspaceClusterSortKey,
  ProductAdvertisingWorkspaceClusterStatusFilter,
  ProductAdvertisingWorkspaceClusterQueriesResponse,
  ProductAdvertisingWorkspaceClusterTableResponse,
} from "./syncClientTypes";

const productWorkspaceClusterTableMemoryCache =
  new Map<string, ProductAdvertisingWorkspaceClusterTableResponse>();
const productWorkspaceClusterQueriesMemoryCache =
  new Map<string, ProductAdvertisingWorkspaceClusterQueriesResponse>();

export function persistClusterBundleToSession(
  _nmId: number,
  _startDate: string,
  _endDate: string,
  _tables: Record<string, ProductAdvertisingWorkspaceClusterTableResponse>,
): void {
  // Exact advertising truth is backend-owned. Bundle persistence is intentionally disabled.
}

export function getClusterBundleFromSession(
  _nmId: number,
  _startDate: string,
  _endDate: string,
): Record<string, ProductAdvertisingWorkspaceClusterTableResponse> | null {
  return null;
}

export function buildProductWorkspaceClusterTableCacheKey(input: {
  nmId: number;
  advertId: number;
  requestInput?: ProductAdvertisingSheetRequestInput | null;
  search?: string;
  clusterNameSearch?: string;
  status?: ProductAdvertisingWorkspaceClusterStatusFilter;
  numericFilters?: ProductAdvertisingWorkspaceClusterNumericFilters;
  // sortKey and sortDirection намеренно исключены из ключа кеша:
  // сортировка выполняется на клиенте через useMemo, поэтому смена
  // колонки сортировки не делает повторный запрос к бэкенду.
  page?: number;
  pageSize?: number;
}) {
  const normalizedInput = normalizeProductAdvertisingSheetRequestInput(input.requestInput);
  return [
    "wb-dashboard-product-workspace-cluster-table",
    String(input.nmId),
    String(input.advertId),
    normalizedInput.startDate,
    normalizedInput.endDate,
    input.search?.trim() ?? "",
    input.clusterNameSearch?.trim() ?? "",
    input.status ?? "all",
    input.numericFilters
      ? JSON.stringify(Object.fromEntries(Object.entries(input.numericFilters).sort()))
      : "null",
    String(input.page ?? 1),
    String(input.pageSize ?? 200),
  ].join(":");
}

export function cacheProductWorkspaceClusterTable(
  key: string,
  value: ProductAdvertisingWorkspaceClusterTableResponse,
) {
  productWorkspaceClusterTableMemoryCache.set(key, value);
}

export function getCachedProductWorkspaceClusterTable(key: string) {
  return productWorkspaceClusterTableMemoryCache.get(key) ?? null;
}

export function invalidateCachedProductWorkspaceClusterTable(key: string) {
  productWorkspaceClusterTableMemoryCache.delete(key);
}

export function invalidateCachedProductWorkspaceClusterTableMatching(input: {
  nmId: number;
  advertId: number;
  requestInput?: ProductAdvertisingSheetRequestInput | null;
}) {
  const normalizedInput = normalizeProductAdvertisingSheetRequestInput(input.requestInput);
  const keyPrefix = [
    "wb-dashboard-product-workspace-cluster-table",
    String(input.nmId),
    String(input.advertId),
    normalizedInput.startDate,
    normalizedInput.endDate,
  ].join(":");

  for (const key of productWorkspaceClusterTableMemoryCache.keys()) {
    if (key.startsWith(keyPrefix)) {
      productWorkspaceClusterTableMemoryCache.delete(key);
    }
  }
}

export function getCachedProductWorkspaceClusterTableEntriesMatching(input: {
  nmId: number;
  advertId: number;
  requestInput?: ProductAdvertisingSheetRequestInput | null;
}) {
  const normalizedInput = normalizeProductAdvertisingSheetRequestInput(input.requestInput);
  const keyPrefix = [
    "wb-dashboard-product-workspace-cluster-table",
    String(input.nmId),
    String(input.advertId),
    normalizedInput.startDate,
    normalizedInput.endDate,
  ].join(":");

  return Array.from(productWorkspaceClusterTableMemoryCache.entries()).filter(([key]) =>
    key.startsWith(keyPrefix),
  );
}

export function buildProductWorkspaceClusterQueriesCacheKey(input: {
  nmId: number;
  advertId: number;
  clusterKey: string;
  requestInput?: ProductAdvertisingSheetRequestInput | null;
  sortKey?: ProductAdvertisingWorkspaceClusterSortKey;
  sortDirection?: ProductAdvertisingWorkspaceClusterSortDirection;
}) {
  const normalizedInput = normalizeProductAdvertisingSheetRequestInput(input.requestInput);
  return [
    "wb-dashboard-product-workspace-cluster-queries",
    String(input.nmId),
    String(input.advertId),
    input.clusterKey,
    normalizedInput.startDate,
    normalizedInput.endDate,
    input.sortKey ?? "spend",
    input.sortDirection ?? "desc",
  ].join(":");
}

export function cacheProductWorkspaceClusterQueries(
  key: string,
  value: ProductAdvertisingWorkspaceClusterQueriesResponse,
) {
  productWorkspaceClusterQueriesMemoryCache.set(key, value);
}

export function getCachedProductWorkspaceClusterQueries(key: string) {
  return productWorkspaceClusterQueriesMemoryCache.get(key) ?? null;
}

export function invalidateCachedProductWorkspaceClusterQueriesMatching(input: {
  nmId: number;
  advertId: number;
  requestInput?: ProductAdvertisingSheetRequestInput | null;
}) {
  const normalizedInput = normalizeProductAdvertisingSheetRequestInput(input.requestInput);
  const keyPrefix = [
    "wb-dashboard-product-workspace-cluster-queries",
    String(input.nmId),
    String(input.advertId),
  ].join(":");

  for (const key of productWorkspaceClusterQueriesMemoryCache.keys()) {
    if (
      key.startsWith(keyPrefix) &&
      key.includes(`:${normalizedInput.startDate}:${normalizedInput.endDate}:`)
    ) {
      productWorkspaceClusterQueriesMemoryCache.delete(key);
    }
  }
}

export function getCachedProductWorkspaceClusterQueriesEntriesMatching(input: {
  nmId: number;
  advertId: number;
  requestInput?: ProductAdvertisingSheetRequestInput | null;
}) {
  const normalizedInput = normalizeProductAdvertisingSheetRequestInput(input.requestInput);
  const keyPrefix = [
    "wb-dashboard-product-workspace-cluster-queries",
    String(input.nmId),
    String(input.advertId),
  ].join(":");

  return Array.from(productWorkspaceClusterQueriesMemoryCache.entries()).filter(([key]) => {
    if (!key.startsWith(keyPrefix)) {
      return false;
    }

    return key.includes(`:${normalizedInput.startDate}:${normalizedInput.endDate}:`);
  });
}
