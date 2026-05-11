import {
  normalizeProductAdvertisingSheetRequestInput,
  type ProductAdvertisingSheetRequestInput,
} from "./productAdvertisingSheetIdentity";
import type { ProductAdvertisingWorkspaceResponse } from "./syncClientTypes";
import { assertProductAdvertisingWorkspaceResponse } from "./syncClientValidators";

// ─── Архитектура кеша ────────────────────────────────────────────────────────
//
// Два слоя персистентного хранения (переживают F5-refresh):
//
// 1. LRU-карта в localStorage (v2) — до 20 записей по ТОЧНОМУ ключу
//    (nmId + startDate + endDate). Обеспечивает мгновенный показ при
//    точном совпадении дат (тот же товар, те же даты).
//
// 2. NmId-only fallback в localStorage — одна запись на товар без учёта дат.
//    Когда пресет "неделя" смещается (новый день) или пользователь выбирает
//    другой диапазон, точный ключ промахивает. Fallback позволяет показать
//    данные за прошлый период МГНОВЕННО пока в фоне грузится свежий запрос
//    (stale-while-revalidate). Это устраняет blank-экран при каждодневных
//    визитах.
//
// 3. In-memory Map — работает в рамках одной вкладки без сериализации.
//
// ─────────────────────────────────────────────────────────────────────────────

const workspaceMapStorageKey = "wb-dashboard-workspace-map-v2";
const workspaceFallbackStorageKey = "wb-dashboard-workspace-fallback-v1";
const workspaceSchemaVersion = 2;
const workspaceFallbackSchemaVersion = 1;
const workspaceMapMaxEntries = 20;

const productWorkspaceMemoryCache = new Map<string, ProductAdvertisingWorkspaceResponse>();

// ─── Типы ────────────────────────────────────────────────────────────────────

type WorkspaceMapEntry = {
  key: string;
  value: ProductAdvertisingWorkspaceResponse;
  storedAt: number;
};

type PersistedWorkspaceMap = {
  schemaVersion: number;
  entries: WorkspaceMapEntry[];
};

// NmId-only fallback: { [nmId: string]: WorkspaceMapEntry }
type PersistedWorkspaceFallbackMap = {
  schemaVersion: number;
  entries: Record<string, WorkspaceMapEntry>;
};

// ─── Утилиты ─────────────────────────────────────────────────────────────────

function isWindowAvailable() {
  return typeof window !== "undefined";
}

function buildExactCacheKey(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput | null,
): string {
  const normalized = normalizeProductAdvertisingSheetRequestInput(input);
  return ["wb-workspace", String(nmId), normalized.startDate, normalized.endDate].join(":");
}

function buildFallbackCacheKey(nmId: number): string {
  return String(nmId);
}

// ─── LRU-карта (точные ключи) ─────────────────────────────────────────────

let exactMapCache: Map<string, WorkspaceMapEntry> | null = null;

function getOrLoadExactMap(): Map<string, WorkspaceMapEntry> {
  if (exactMapCache !== null) return exactMapCache;
  exactMapCache = new Map();
  if (!isWindowAvailable()) return exactMapCache;
  try {
    const raw = window.localStorage.getItem(workspaceMapStorageKey);
    if (!raw) return exactMapCache;
    const parsed = JSON.parse(raw) as PersistedWorkspaceMap;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.schemaVersion !== workspaceSchemaVersion ||
      !Array.isArray(parsed.entries)
    ) {
      window.localStorage.removeItem(workspaceMapStorageKey);
      return exactMapCache;
    }
    for (const entry of parsed.entries) {
      if (entry && typeof entry.key === "string" && typeof entry.storedAt === "number") {
        exactMapCache.set(entry.key, entry);
      }
    }
  } catch {
    try { window.localStorage.removeItem(workspaceMapStorageKey); } catch { /* ignore */ }
  }
  return exactMapCache;
}

function writeExactMap(map: Map<string, WorkspaceMapEntry>) {
  if (!isWindowAvailable()) return;
  const entries = [...map.values()].sort((a, b) => a.storedAt - b.storedAt);
  const payload: PersistedWorkspaceMap = { schemaVersion: workspaceSchemaVersion, entries };
  try {
    window.localStorage.setItem(workspaceMapStorageKey, JSON.stringify(payload));
  } catch {
    // Quota exceeded — обрезаем пополам
    try {
      const trimmed = entries.slice(-Math.floor(workspaceMapMaxEntries / 2));
      window.localStorage.setItem(
        workspaceMapStorageKey,
        JSON.stringify({ schemaVersion: workspaceSchemaVersion, entries: trimmed }),
      );
    } catch { /* ignore — работаем через in-memory */ }
  }
}

// ─── Fallback-карта (только nmId) ────────────────────────────────────────────

let fallbackMapCache: Record<string, WorkspaceMapEntry> | null = null;

function getOrLoadFallbackMap(): Record<string, WorkspaceMapEntry> {
  if (fallbackMapCache !== null) return fallbackMapCache;
  fallbackMapCache = {};
  if (!isWindowAvailable()) return fallbackMapCache;
  try {
    const raw = window.localStorage.getItem(workspaceFallbackStorageKey);
    if (!raw) return fallbackMapCache;
    const parsed = JSON.parse(raw) as PersistedWorkspaceFallbackMap;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.schemaVersion !== workspaceFallbackSchemaVersion ||
      typeof parsed.entries !== "object"
    ) {
      window.localStorage.removeItem(workspaceFallbackStorageKey);
      return fallbackMapCache;
    }
    fallbackMapCache = parsed.entries;
  } catch {
    try { window.localStorage.removeItem(workspaceFallbackStorageKey); } catch { /* ignore */ }
  }
  return fallbackMapCache;
}

function writeFallbackMap(map: Record<string, WorkspaceMapEntry>) {
  if (!isWindowAvailable()) return;
  const payload: PersistedWorkspaceFallbackMap = {
    schemaVersion: workspaceFallbackSchemaVersion,
    entries: map,
  };
  try {
    window.localStorage.setItem(workspaceFallbackStorageKey, JSON.stringify(payload));
  } catch { /* ignore */ }
}

// ─── Публичный API ────────────────────────────────────────────────────────────

export function cacheProductWorkspace(
  nmId: number,
  input: ProductAdvertisingSheetRequestInput | undefined,
  value: ProductAdvertisingWorkspaceResponse,
) {
  const exactKey = buildExactCacheKey(nmId, input);
  const fallbackKey = buildFallbackCacheKey(nmId);
  const now = Date.now();

  // In-memory
  productWorkspaceMemoryCache.set(exactKey, value);

  // LRU exact map
  const exactMap = getOrLoadExactMap();
  exactMap.set(exactKey, { key: exactKey, value, storedAt: now });
  if (exactMap.size > workspaceMapMaxEntries) {
    const sorted = [...exactMap.values()].sort((a, b) => a.storedAt - b.storedAt);
    for (let i = 0; i < exactMap.size - workspaceMapMaxEntries; i++) {
      exactMap.delete(sorted[i].key);
    }
  }
  writeExactMap(exactMap);

  // NmId-only fallback (всегда обновляем до самого свежего)
  const fallbackMap = getOrLoadFallbackMap();
  fallbackMap[fallbackKey] = { key: exactKey, value, storedAt: now };
  writeFallbackMap(fallbackMap);
}

export function getCachedProductWorkspace(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput | null,
): ProductAdvertisingWorkspaceResponse | null {
  const exactKey = buildExactCacheKey(nmId, input);

  // 1. In-memory (нет сериализации)
  const memHit = productWorkspaceMemoryCache.get(exactKey);
  if (memHit) return memHit;

  // 2. Точный ключ из localStorage
  const exactMap = getOrLoadExactMap();
  const exactEntry = exactMap.get(exactKey);
  if (exactEntry) {
    try {
      assertProductAdvertisingWorkspaceResponse(exactEntry.value);
      productWorkspaceMemoryCache.set(exactKey, exactEntry.value);
      return exactEntry.value;
    } catch {
      exactMap.delete(exactKey);
      writeExactMap(exactMap);
    }
  }

  // 3. NmId-only fallback — показываем stale данные пока грузится свежий запрос.
  //    shouldBackgroundRefreshWorkspace в useProductAdvertisingWorkspace заметит
  //    устаревший checkedAt и запустит фоновое обновление автоматически.
  const fallbackKey = buildFallbackCacheKey(nmId);
  const fallbackMap = getOrLoadFallbackMap();
  const fallbackEntry = fallbackMap[fallbackKey];
  if (fallbackEntry) {
    try {
      assertProductAdvertisingWorkspaceResponse(fallbackEntry.value);
      // Кладём в memory по EXACT ключу чтобы при повторном рендере не читать localStorage снова.
      productWorkspaceMemoryCache.set(exactKey, fallbackEntry.value);
      return fallbackEntry.value;
    } catch {
      delete fallbackMap[fallbackKey];
      writeFallbackMap(fallbackMap);
    }
  }

  return null;
}

/** Только для тестов: сбрасывает все in-process синглтоны кешей. */
export function _resetWorkspaceCacheForTests() {
  productWorkspaceMemoryCache.clear();
  exactMapCache = null;
  fallbackMapCache = null;
}

export function invalidateCachedProductWorkspace(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput | null,
) {
  const exactKey = buildExactCacheKey(nmId, input);
  productWorkspaceMemoryCache.delete(exactKey);

  const exactMap = getOrLoadExactMap();
  if (exactMap.has(exactKey)) {
    exactMap.delete(exactKey);
    writeExactMap(exactMap);
  }

  // Fallback не удаляем при инвалидации конкретного диапазона —
  // он нужен как последний резерв для показа при смене дат.
}
