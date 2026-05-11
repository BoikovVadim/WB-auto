// In-memory cache so reads don't hit sessionStorage on every scroll event.
const memoryCache = new Map<string, number>();

function storageKey(key: string): string {
  return `wb-scroll:${key}`;
}

export function saveScrollPosition(key: string, y: number): void {
  memoryCache.set(key, y);
  try {
    window.sessionStorage.setItem(storageKey(key), String(Math.round(y)));
  } catch {
    // sessionStorage unavailable — memory cache still works within the session.
  }
}

export function loadScrollPosition(key: string): number {
  const cached = memoryCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const raw = window.sessionStorage.getItem(storageKey(key));
    if (!raw) return 0;
    const n = Number(raw);
    const value = Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    memoryCache.set(key, value);
    return value;
  } catch {
    return 0;
  }
}

export function clearScrollPosition(key: string): void {
  memoryCache.delete(key);
  try {
    window.sessionStorage.removeItem(storageKey(key));
  } catch {
    // ignore
  }
}
