import type { ProductAdvertisingSheetRequestInput } from "./productAdvertisingSheetIdentity";
import { normalizeProductAdvertisingSheetRequestInput } from "./productAdvertisingSheetIdentity";
import type { ProductAdvertisingWorkspaceResponse } from "./syncClientTypes";

// In-memory only — никакого localStorage/sessionStorage.
// PostgreSQL отвечает достаточно быстро; персистентный кэш только создавал
// проблемы с совместимостью при обновлениях схемы.
const productWorkspaceMemoryCache = new Map<string, ProductAdvertisingWorkspaceResponse>();

function buildExactCacheKey(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput | null,
): string {
  const normalized = normalizeProductAdvertisingSheetRequestInput(input);
  return ["wb-workspace", String(nmId), normalized.startDate, normalized.endDate].join(":");
}

export function cacheProductWorkspace(
  nmId: number,
  input: ProductAdvertisingSheetRequestInput | undefined,
  value: ProductAdvertisingWorkspaceResponse,
) {
  productWorkspaceMemoryCache.set(buildExactCacheKey(nmId, input), value);
}

export function getCachedProductWorkspace(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput | null,
): ProductAdvertisingWorkspaceResponse | null {
  return productWorkspaceMemoryCache.get(buildExactCacheKey(nmId, input)) ?? null;
}

export function invalidateCachedProductWorkspace(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput | null,
) {
  productWorkspaceMemoryCache.delete(buildExactCacheKey(nmId, input));
}

/** Только для тестов: сбрасывает все синглтоны. */
export function _resetWorkspaceCacheForTests() {
  productWorkspaceMemoryCache.clear();
}
