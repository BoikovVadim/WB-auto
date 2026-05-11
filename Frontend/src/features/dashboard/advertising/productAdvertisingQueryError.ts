export function normalizeProductAdvertisingQueryError(
  error: unknown,
  fallback = "Не удалось загрузить данные по товару.",
): string | null {
  if (
    error instanceof Error &&
    /timeout|exceeded|network error|connection reset|socket hang up|fetch failed|econnreset/i.test(
      error.message,
    )
  ) {
    return null;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}
