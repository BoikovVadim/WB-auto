import type { UnifiedChangeLogEntry } from "./syncClientChangeLog";

/**
 * Кэш единой «Истории изменений» (memory + sessionStorage) для мгновенного первого кадра
 * при повторном заходе/F5 — без ожидания сети. Раздел читает кэш синхронно, рисует его и
 * параллельно ревалидирует в фоне (SWR-стиль). Ключ — limit (единственный параметр запроса).
 *
 * sessionStorage (не localStorage): история — рабочие данные одной сессии, не должны
 * переживать закрытие вкладки; схема ответа может меняться между деплоями.
 */
const memoryCache = new Map<number, UnifiedChangeLogEntry[]>();
// v2: ответ обзавёлся полем `cursor` (курсорная пагинация) — старый кэш без него непригоден.
const storageKey = (limit: number) => `wb-change-history:v2:${String(limit)}`;

function isWindowAvailable() {
  return typeof window !== "undefined";
}

export function cacheChangeLog(limit: number, entries: UnifiedChangeLogEntry[]) {
  memoryCache.set(limit, entries);
  if (!isWindowAvailable()) {
    return;
  }
  try {
    window.sessionStorage.setItem(storageKey(limit), JSON.stringify(entries));
  } catch {
    return;
  }
}

export function getCachedChangeLog(limit: number): UnifiedChangeLogEntry[] | null {
  const memoryCached = memoryCache.get(limit);
  if (memoryCached) {
    return memoryCached;
  }
  if (!isWindowAvailable()) {
    return null;
  }
  try {
    const rawValue = window.sessionStorage.getItem(storageKey(limit));
    if (!rawValue) {
      return null;
    }
    const parsed: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const entries = parsed as UnifiedChangeLogEntry[];
    memoryCache.set(limit, entries);
    return entries;
  } catch {
    return null;
  }
}
