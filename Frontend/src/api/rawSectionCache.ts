/**
 * Универсальный кэш «сырых» табличных разделов дашборда (memory + sessionStorage) для
 * мгновенного первого кадра при повторном заходе/F5 — без ожидания сети. RawTableSection
 * читает кэш синхронно по cacheKey, рисует его и ревалидирует в фоне (SWR-стиль).
 *
 * sessionStorage (не localStorage): сырые таблицы — рабочие данные одной сессии; формат
 * строк может меняться между деплоями, переживать закрытие вкладки им не нужно. Версия в
 * ключе (v1) обрубает несовместимый кэш при смене схемы.
 */
const memoryCache = new Map<string, unknown[]>();
const storageKey = (cacheKey: string) => `wb-raw-section:v1:${cacheKey}`;

function isWindowAvailable() {
  return typeof window !== "undefined";
}

export function cacheRawSection<T>(cacheKey: string, rows: T[]) {
  memoryCache.set(cacheKey, rows);
  if (!isWindowAvailable()) {
    return;
  }
  try {
    window.sessionStorage.setItem(storageKey(cacheKey), JSON.stringify(rows));
  } catch {
    return;
  }
}

export function getCachedRawSection<T>(cacheKey: string): T[] | null {
  const memoryCached = memoryCache.get(cacheKey);
  if (memoryCached) {
    return memoryCached as T[];
  }
  if (!isWindowAvailable()) {
    return null;
  }
  try {
    const rawValue = window.sessionStorage.getItem(storageKey(cacheKey));
    if (!rawValue) {
      return null;
    }
    const parsed: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return null;
    }
    memoryCache.set(cacheKey, parsed);
    return parsed as T[];
  } catch {
    return null;
  }
}
