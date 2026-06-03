import {
  normalizeProductAdvertisingSheetRequestInput,
  type ProductAdvertisingSheetRequestInput,
} from "./productAdvertisingSheetIdentity";
import { createSessionPersistedCache } from "./sessionPersistedCache";
import { assertProductAdvertisingWorkspaceClusterTableResponse } from "./syncClientAdvertisingWorkspaceValidators";
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

// Бандл РК-таблиц по товару (advertId → таблица) в sessionStorage: переживает F5,
// чтобы первый кадр был мгновенным. Защита версией/TTL/валидацией — в sessionPersistedCache;
// валидируем каждую таблицу assert-ом, при несовместимости весь бандл игнорируется как miss.
type ClusterBundle = Record<string, ProductAdvertisingWorkspaceClusterTableResponse>;
const CLUSTER_BUNDLE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const clusterBundleSessionCache = createSessionPersistedCache<ClusterBundle>({
  namespace: "wbcb",
  ttlMs: CLUSTER_BUNDLE_SESSION_TTL_MS,
  validate: (value): value is ClusterBundle => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    try {
      for (const table of Object.values(value as Record<string, unknown>)) {
        assertProductAdvertisingWorkspaceClusterTableResponse(table);
      }
      return true;
    } catch {
      return false;
    }
  },
});

function buildClusterBundleSessionKey(nmId: number, startDate: string, endDate: string): string {
  return [String(nmId), startDate, endDate].join(":");
}

function buildClusterBundleLatestKey(nmId: number): string {
  return ["latest", String(nmId)].join(":");
}

export function persistClusterBundleToSession(
  nmId: number,
  startDate: string,
  endDate: string,
  tables: Record<string, ProductAdvertisingWorkspaceClusterTableResponse>,
): void {
  if (Object.keys(tables).length === 0) return;
  clusterBundleSessionCache.write(buildClusterBundleSessionKey(nmId, startDate, endDate), tables);
  // Латест-по-товару: на F5 период «прыгает», точный ключ промахивается — этот fallback
  // даёт мгновенный кадр таблицы РК (ревалидация под актуальный период подменит данные).
  clusterBundleSessionCache.write(buildClusterBundleLatestKey(nmId), tables);
}

export function getClusterBundleFromSession(
  nmId: number,
  startDate: string,
  endDate: string,
): Record<string, ProductAdvertisingWorkspaceClusterTableResponse> | null {
  return clusterBundleSessionCache.read(buildClusterBundleSessionKey(nmId, startDate, endDate));
}

/**
 * Синхронно достаёт таблицу одной РК из персистентного бандла — для инициализации хука
 * таблицы после F5, чтобы первый кадр был без скелетона (memory ещё пуст). Данные могут
 * быть слегка stale — фоновая ревалидация обновит их на месте.
 */
export function getCachedClusterTableFromSessionBundle(input: {
  nmId: number;
  advertId: number;
  requestInput?: ProductAdvertisingSheetRequestInput | null;
}): ProductAdvertisingWorkspaceClusterTableResponse | null {
  const normalizedInput = normalizeProductAdvertisingSheetRequestInput(input.requestInput);
  const exact = getClusterBundleFromSession(
    input.nmId,
    normalizedInput.startDate,
    normalizedInput.endDate,
  );
  const fromExact = exact?.[String(input.advertId)] ?? null;
  if (fromExact) return fromExact;
  // Точный период ещё не устаканился (today→период из export) — берём latest-по-товару.
  const latest = clusterBundleSessionCache.read(buildClusterBundleLatestKey(input.nmId));
  return latest?.[String(input.advertId)] ?? null;
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
  // Данные таблицы изменились — выкидываем и персистентный бандл товара (он по nmId+период,
  // содержит все РК), иначе после F5 мог бы мгновенно показаться stale до ревалидации.
  clusterBundleSessionCache.remove(
    buildClusterBundleSessionKey(input.nmId, normalizedInput.startDate, normalizedInput.endDate),
  );
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
