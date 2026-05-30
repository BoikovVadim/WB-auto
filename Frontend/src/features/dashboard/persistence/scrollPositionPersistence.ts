// In-memory cache so reads don't hit sessionStorage on every scroll event.
const memoryCache = new Map<string, number>();

// Debounce-таймеры записи в sessionStorage по ключу. sessionStorage.setItem —
// синхронная блокирующая операция; вызывать её на каждый scroll-event (60+/сек)
// = джанк главного потока и «пропадание» строк виртуализированных таблиц.
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

function storageKey(key: string): string {
  return `wb-scroll:${key}`;
}

export function saveScrollPosition(key: string, y: number): void {
  // Память обновляем синхронно — same-session restore (возврат из detail) всегда
  // получает актуальную позицию, даже если debounce-запись в storage ещё не успела.
  memoryCache.set(key, y);

  // sessionStorage пишем только после того, как скролл «успокоился» (debounce 150 мс):
  // во время активного скролла записей в storage нет вообще, восстановление после
  // F5 получает финальную позицию покоя.
  const existing = flushTimers.get(key);
  if (existing !== undefined) {
    clearTimeout(existing);
  }
  flushTimers.set(
    key,
    setTimeout(() => {
      flushTimers.delete(key);
      try {
        window.sessionStorage.setItem(storageKey(key), String(Math.round(y)));
      } catch {
        // sessionStorage unavailable — memory cache still works within the session.
      }
    }, 150),
  );
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
  const pending = flushTimers.get(key);
  if (pending !== undefined) {
    clearTimeout(pending);
    flushTimers.delete(key);
  }
  try {
    window.sessionStorage.removeItem(storageKey(key));
  } catch {
    // ignore
  }
}
