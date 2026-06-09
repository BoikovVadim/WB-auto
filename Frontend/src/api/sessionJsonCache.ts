/**
 * Универсальный кэш произвольного JSON-значения (memory + sessionStorage) для мгновенного
 * первого кадра при повторном заходе/F5. Для объектов (настройки и т.п.); для табличных
 * массивов есть rawSectionCache/changeLogCache. Версия в ключе (v1) обрубает несовместимый
 * кэш при смене схемы; sessionStorage — данные одной сессии.
 */
const memoryCache = new Map<string, unknown>();
const storageKey = (key: string) => `wb-json:v1:${key}`;

function isWindowAvailable() {
  return typeof window !== "undefined";
}

export function cacheSessionJson<T>(key: string, value: T) {
  memoryCache.set(key, value);
  if (!isWindowAvailable()) {
    return;
  }
  try {
    window.sessionStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    return;
  }
}

export function getCachedSessionJson<T>(key: string): T | null {
  const memoryCached = memoryCache.get(key);
  if (memoryCached !== undefined) {
    return memoryCached as T;
  }
  if (!isWindowAvailable()) {
    return null;
  }
  try {
    const rawValue = window.sessionStorage.getItem(storageKey(key));
    if (!rawValue) {
      return null;
    }
    const parsed: unknown = JSON.parse(rawValue);
    memoryCache.set(key, parsed);
    return parsed as T;
  } catch {
    return null;
  }
}
