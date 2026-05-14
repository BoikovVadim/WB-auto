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

// ─── Per-key localStorage cache for cluster table ────────────────────────────
// Supplements sessionStorage: survives tab close / browser restart so the first
// product open after a new session is instant (stale-while-revalidate).
// Shorter TTL (20 min) than session (4 h) to limit stale bid/action exposure.
// Max 20 entries with LRU eviction (same ceiling as the workspace LS cache).
const CLUSTER_TABLE_LS_KEY = "wb-clt-ls-v1";
const CLUSTER_TABLE_LS_TTL_MS = 20 * 60 * 1000;
const CLUSTER_TABLE_LS_MAX_ENTRIES = 20;

type PersistedClusterTableEntry = {
  savedAt: number;
  table: ProductAdvertisingWorkspaceClusterTableResponse;
};

type PersistedClusterTableLsMap = {
  schemaVersion: number;
  entries: Array<{ key: string; savedAt: number; table: ProductAdvertisingWorkspaceClusterTableResponse }>;
};

const CLUSTER_TABLE_LS_SCHEMA_VERSION = 1;

let clusterTableLsCache: Map<string, PersistedClusterTableEntry> | null = null;

function getOrLoadClusterTableLsCache(): Map<string, PersistedClusterTableEntry> {
  if (clusterTableLsCache !== null) return clusterTableLsCache;
  clusterTableLsCache = new Map();
  if (!isWindowAvailable()) return clusterTableLsCache;
  try {
    const raw = window.localStorage.getItem(CLUSTER_TABLE_LS_KEY);
    if (!raw) return clusterTableLsCache;
    const parsed = JSON.parse(raw) as PersistedClusterTableLsMap;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.schemaVersion !== CLUSTER_TABLE_LS_SCHEMA_VERSION ||
      !Array.isArray(parsed.entries)
    ) {
      window.localStorage.removeItem(CLUSTER_TABLE_LS_KEY);
      return clusterTableLsCache;
    }
    const now = Date.now();
    for (const e of parsed.entries) {
      if (e && typeof e.key === "string" && now - e.savedAt <= CLUSTER_TABLE_LS_TTL_MS) {
        clusterTableLsCache.set(e.key, { savedAt: e.savedAt, table: e.table });
      }
    }
  } catch {
    try { window.localStorage.removeItem(CLUSTER_TABLE_LS_KEY); } catch { /* ignore */ }
  }
  return clusterTableLsCache;
}

function writeClusterTableLsCache(map: Map<string, PersistedClusterTableEntry>): void {
  if (!isWindowAvailable()) return;
  const entries = [...map.entries()].map(([key, e]) => ({ key, savedAt: e.savedAt, table: e.table }));
  entries.sort((a, b) => a.savedAt - b.savedAt);
  const payload: PersistedClusterTableLsMap = {
    schemaVersion: CLUSTER_TABLE_LS_SCHEMA_VERSION,
    entries,
  };
  try {
    window.localStorage.setItem(CLUSTER_TABLE_LS_KEY, JSON.stringify(payload));
  } catch {
    try {
      const trimmed = entries.slice(-Math.floor(CLUSTER_TABLE_LS_MAX_ENTRIES / 2));
      window.localStorage.setItem(
        CLUSTER_TABLE_LS_KEY,
        JSON.stringify({ schemaVersion: CLUSTER_TABLE_LS_SCHEMA_VERSION, entries: trimmed }),
      );
    } catch { /* ignore */ }
  }
}

function saveClusterTableEntryToLs(key: string, value: ProductAdvertisingWorkspaceClusterTableResponse): void {
  const map = getOrLoadClusterTableLsCache();
  const now = Date.now();
  map.set(key, { savedAt: now, table: value });
  if (map.size > CLUSTER_TABLE_LS_MAX_ENTRIES) {
    const sorted = [...map.entries()].sort((a, b) => a[1].savedAt - b[1].savedAt);
    for (let i = 0; i < map.size - CLUSTER_TABLE_LS_MAX_ENTRIES; i++) {
      map.delete(sorted[i][0]);
    }
  }
  writeClusterTableLsCache(map);
}

function loadClusterTableEntryFromLs(key: string): ProductAdvertisingWorkspaceClusterTableResponse | null {
  const map = getOrLoadClusterTableLsCache();
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > CLUSTER_TABLE_LS_TTL_MS) {
    map.delete(key);
    writeClusterTableLsCache(map);
    return null;
  }
  return entry.table;
}

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
  // Persist default-view responses so the next session/page-refresh is instant.
  if (isDefaultClusterTableKey(key)) {
    saveClusterTableEntryToSession(key, value);
    // Also write to localStorage (survives tab close, 20-min TTL) so the very
    // first product open after a new browser session skips the 100-500 ms fetch.
    saveClusterTableEntryToLs(key, value);
  }
}

export function getCachedProductWorkspaceClusterTable(key: string) {
  const memHit = productWorkspaceClusterTableMemoryCache.get(key) ?? null;
  if (memHit) return memHit;
  // Tier 2: sessionStorage (survives F5 within the same tab, TTL 4 h).
  const sessionHit = loadClusterTableEntryFromSession(key);
  if (sessionHit) {
    productWorkspaceClusterTableMemoryCache.set(key, sessionHit);
    return sessionHit;
  }
  // Tier 3: localStorage (survives tab close / browser restart, TTL 20 min).
  // Stale-while-revalidate: serves old table immediately; background fetch
  // updates it and sets isTableRefreshing = false when the response arrives.
  if (isDefaultClusterTableKey(key)) {
    const lsHit = loadClusterTableEntryFromLs(key);
    if (lsHit) {
      productWorkspaceClusterTableMemoryCache.set(key, lsHit);
      return lsHit;
    }
  }
  return null;
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
