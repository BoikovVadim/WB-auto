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

// ─── Per-key sessionStorage cache for cluster table ──────────────────────────
// Persists the "default view" cluster table response (no search, default sort,
// page 1, pageSize 5000) so that after a page refresh getCachedProductWorkspace-
// ClusterTable immediately returns a value → isTableRefreshing stays false and
// the table is interactive from the first render.

const CLUSTER_TABLE_ENTRY_SESSION_PREFIX = "wb-clt-v1:";
// 4 h — keeps data visible on tab-restore and refreshes well beyond a typical
// work session; the server-side snapshot TTL is also 20 min so stale risk is low.
const CLUSTER_TABLE_ENTRY_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

type PersistedClusterTableEntry = {
  savedAt: number;
  table: ProductAdvertisingWorkspaceClusterTableResponse;
};

// Detects the "default" cache key shape:
// "...:nmId:advertId:start:end:::null:spend:desc:1:5000"
// Only these are worth persisting; search/filter variants are transient.
function isDefaultClusterTableKey(key: string): boolean {
  return key.endsWith(":::null:spend:desc:1:5000");
}

function saveClusterTableEntryToSession(
  key: string,
  value: ProductAdvertisingWorkspaceClusterTableResponse,
): void {
  if (!isWindowAvailable()) return;
  try {
    const entry: PersistedClusterTableEntry = { savedAt: Date.now(), table: value };
    window.sessionStorage.setItem(
      CLUSTER_TABLE_ENTRY_SESSION_PREFIX + key,
      JSON.stringify(entry),
    );
  } catch {
    // sessionStorage quota exceeded – silently skip
  }
}

function loadClusterTableEntryFromSession(
  key: string,
): ProductAdvertisingWorkspaceClusterTableResponse | null {
  if (!isWindowAvailable()) return null;
  try {
    const raw = window.sessionStorage.getItem(CLUSTER_TABLE_ENTRY_SESSION_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as PersistedClusterTableEntry;
    if (!entry || typeof entry !== "object") return null;
    if (Date.now() - entry.savedAt > CLUSTER_TABLE_ENTRY_SESSION_TTL_MS) {
      window.sessionStorage.removeItem(CLUSTER_TABLE_ENTRY_SESSION_PREFIX + key);
      return null;
    }
    return entry.table;
  } catch {
    return null;
  }
}

// ─── Session-storage bundle cache ────────────────────────────────────────────
// Per-product bundle: "wb-dashboard-bundle-v3:{nmId}".
// Each product gets its own key so switching from product A to B does not evict
// A's cache entry. The previous single-key scheme (v1/v2) meant opening B always
// invalidated A on the next back-navigation.

const BUNDLE_SESSION_KEY_PREFIX = "wb-dashboard-bundle-v3:";
const BUNDLE_SCHEMA_VERSION = 3;

type PersistedClusterBundle = {
  schemaVersion: number;
  nmId: number;
  startDate: string;
  endDate: string;
  tables: Record<string, ProductAdvertisingWorkspaceClusterTableResponse>;
};

function isWindowAvailable() {
  return typeof window !== "undefined";
}

export function persistClusterBundleToSession(
  nmId: number,
  startDate: string,
  endDate: string,
  tables: Record<string, ProductAdvertisingWorkspaceClusterTableResponse>,
): void {
  if (!isWindowAvailable()) return;
  try {
    const payload: PersistedClusterBundle = {
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      nmId,
      startDate,
      endDate,
      tables,
    };
    window.sessionStorage.setItem(
      BUNDLE_SESSION_KEY_PREFIX + String(nmId),
      JSON.stringify(payload),
    );
  } catch {
    // sessionStorage quota exceeded – silently skip
  }
}

export function getClusterBundleFromSession(
  nmId: number,
  startDate: string,
  endDate: string,
): Record<string, ProductAdvertisingWorkspaceClusterTableResponse> | null {
  if (!isWindowAvailable()) return null;
  try {
    const raw = window.sessionStorage.getItem(BUNDLE_SESSION_KEY_PREFIX + String(nmId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedClusterBundle;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.schemaVersion !== BUNDLE_SCHEMA_VERSION ||
      parsed.nmId !== nmId ||
      parsed.startDate !== startDate ||
      parsed.endDate !== endDate
    ) {
      return null;
    }
    return parsed.tables;
  } catch {
    return null;
  }
}

export function buildProductWorkspaceClusterTableCacheKey(input: {
  nmId: number;
  advertId: number;
  requestInput?: ProductAdvertisingSheetRequestInput | null;
  search?: string;
  status?: ProductAdvertisingWorkspaceClusterStatusFilter;
  numericFilters?: ProductAdvertisingWorkspaceClusterNumericFilters;
  sortKey?: ProductAdvertisingWorkspaceClusterSortKey;
  sortDirection?: ProductAdvertisingWorkspaceClusterSortDirection;
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
    input.status ?? "all",
    // Sort keys before serialising so {a:1,b:2} and {b:2,a:1} produce the same cache key.
    input.numericFilters
      ? JSON.stringify(Object.fromEntries(Object.entries(input.numericFilters).sort()))
      : "null",
    input.sortKey ?? "spend",
    input.sortDirection ?? "desc",
    String(input.page ?? 1),
    String(input.pageSize ?? 200),
  ].join(":");
}

export function cacheProductWorkspaceClusterTable(
  key: string,
  value: ProductAdvertisingWorkspaceClusterTableResponse,
) {
  productWorkspaceClusterTableMemoryCache.set(key, value);
  // Persist default-view responses so the next page refresh is instant.
  if (isDefaultClusterTableKey(key)) {
    saveClusterTableEntryToSession(key, value);
  }
}

export function getCachedProductWorkspaceClusterTable(key: string) {
  const memHit = productWorkspaceClusterTableMemoryCache.get(key) ?? null;
  if (memHit) return memHit;
  // Fallback: sessionStorage (survives page refresh, TTL 4 h).
  const sessionHit = loadClusterTableEntryFromSession(key);
  if (sessionHit) {
    // Warm memory cache so subsequent synchronous reads are free.
    productWorkspaceClusterTableMemoryCache.set(key, sessionHit);
  }
  return sessionHit;
}

export function invalidateCachedProductWorkspaceClusterTable(key: string) {
  productWorkspaceClusterTableMemoryCache.delete(key);
  if (isWindowAvailable()) {
    try { window.sessionStorage.removeItem(CLUSTER_TABLE_ENTRY_SESSION_PREFIX + key); } catch { /* ignore */ }
  }
}

function clearSessionClusterTableEntriesWithPrefix(keyPrefix: string): void {
  if (!isWindowAvailable()) return;
  try {
    const sessionPrefix = CLUSTER_TABLE_ENTRY_SESSION_PREFIX + keyPrefix;
    const toRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(sessionPrefix)) toRemove.push(k);
    }
    for (const k of toRemove) window.sessionStorage.removeItem(k);
  } catch { /* ignore */ }
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
  clearSessionClusterTableEntriesWithPrefix(keyPrefix);
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
    if (!key.startsWith(keyPrefix)) {
      continue;
    }

    if (key.includes(`:${normalizedInput.startDate}:${normalizedInput.endDate}:`)) {
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
