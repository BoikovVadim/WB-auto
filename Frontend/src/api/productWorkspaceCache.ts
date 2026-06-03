import type { ProductAdvertisingSheetRequestInput } from "./productAdvertisingSheetIdentity";
import { normalizeProductAdvertisingSheetRequestInput } from "./productAdvertisingSheetIdentity";
import { createSessionPersistedCache } from "./sessionPersistedCache";
import { assertProductAdvertisingWorkspaceResponse } from "./syncClientAdvertisingWorkspaceValidators";
import type { ProductAdvertisingWorkspaceResponse } from "./syncClientTypes";

// Память — быстрый слой; sessionStorage — чтобы данные пережили F5 и первый кадр был
// мгновенным (рендер из кэша, ревалидация в фоне). Персист защищён версией/TTL/валидацией
// (см. sessionPersistedCache) — это снимает прежнюю причину «несовместимости при смене схемы».
const productWorkspaceMemoryCache = new Map<string, ProductAdvertisingWorkspaceResponse>();

const WORKSPACE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const productWorkspaceSessionCache = createSessionPersistedCache<ProductAdvertisingWorkspaceResponse>({
  namespace: "wbws",
  ttlMs: WORKSPACE_SESSION_TTL_MS,
  validate: (value): value is ProductAdvertisingWorkspaceResponse => {
    try {
      assertProductAdvertisingWorkspaceResponse(value);
      return true;
    } catch {
      return false;
    }
  },
});

function buildExactCacheKey(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput | null,
): string {
  const normalized = normalizeProductAdvertisingSheetRequestInput(input);
  return ["wb-workspace", String(nmId), normalized.startDate, normalized.endDate].join(":");
}

function buildLatestCacheKey(nmId: number): string {
  return ["wb-workspace-latest", String(nmId)].join(":");
}

export function cacheProductWorkspace(
  nmId: number,
  input: ProductAdvertisingSheetRequestInput | undefined,
  value: ProductAdvertisingWorkspaceResponse,
) {
  const key = buildExactCacheKey(nmId, input);
  productWorkspaceMemoryCache.set(key, value);
  productWorkspaceSessionCache.write(key, value);
  // Дополнительно — под ключом «последний по товару». На F5 период (requestInput) сначала
  // «прыгает» (today→период из export), поэтому точный ключ промахивается; latest-by-nmId
  // даёт мгновенный кадр последнего показанного воркспейса, ревалидация подменит актуальным.
  productWorkspaceSessionCache.write(buildLatestCacheKey(nmId), value);
}

export function getCachedProductWorkspace(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput | null,
): ProductAdvertisingWorkspaceResponse | null {
  const key = buildExactCacheKey(nmId, input);
  const fromMemory = productWorkspaceMemoryCache.get(key);
  if (fromMemory) return fromMemory;
  // После F5 память пуста — гидрируем её из sessionStorage, чтобы рендер был мгновенным.
  const fromSession = productWorkspaceSessionCache.read(key);
  if (fromSession) {
    productWorkspaceMemoryCache.set(key, fromSession);
    return fromSession;
  }
  // Точный период ещё не устаканился — отдаём последний воркспейс товара (stale-while-revalidate).
  const latest = productWorkspaceSessionCache.read(buildLatestCacheKey(nmId));
  if (latest) return latest;
  return null;
}

export function invalidateCachedProductWorkspace(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput | null,
) {
  const key = buildExactCacheKey(nmId, input);
  productWorkspaceMemoryCache.delete(key);
  productWorkspaceSessionCache.remove(key);
}

/** Только для тестов: сбрасывает все синглтоны. */
export function _resetWorkspaceCacheForTests() {
  productWorkspaceMemoryCache.clear();
  productWorkspaceSessionCache.removeByPrefix("");
}
