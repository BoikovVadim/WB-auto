import {
  buildProductAdvertisingSheetCacheKey,
  buildProductAdvertisingSheetRequestKey,
  type ProductAdvertisingSheetRequestInput,
} from "./productAdvertisingSheetIdentity";
import type { ProductAdvertisingSheetResponse } from "./syncClientTypes";
import {
  deleteProductAdvertisingSheetFromIndexedDb,
  readProductAdvertisingSheetFromIndexedDb,
  writeProductAdvertisingSheetToIndexedDb,
} from "./productSnapshotCacheIndexedDb";
import {
  clearLatestProductAdvertisingSheetFromSessionStorage,
  clearLocalStorageProductAdvertisingSheet,
  deleteMemoryCachedProductAdvertisingSheet,
  getMemoryCachedProductAdvertisingSheetByKey,
  readLatestProductAdvertisingSheetFromSessionStorage,
  readLocalStorageProductAdvertisingSheet,
  setMemoryCachedProductAdvertisingSheet,
  type PreparedProductAdvertisingSheetMap,
  writeLatestProductAdvertisingSheetToSessionStorage,
  writeLocalStorageProductAdvertisingSheet,
} from "./productSnapshotCacheStorage";

export type { PreparedProductAdvertisingSheetMap } from "./productSnapshotCacheStorage";

export function cacheProductAdvertisingSheet(
  nmId: number,
  input: ProductAdvertisingSheetRequestInput | undefined,
  value: ProductAdvertisingSheetResponse,
  options?: {
    persistToLocalStorage?: boolean;
  },
) {
  const cacheKey = buildProductAdvertisingSheetCacheKey(nmId, input);
  setMemoryCachedProductAdvertisingSheet(cacheKey, value);
  writeLatestProductAdvertisingSheetToSessionStorage(cacheKey, value);
  void writeProductAdvertisingSheetToIndexedDb(cacheKey, value);
  if (options?.persistToLocalStorage === true) {
    writeLocalStorageProductAdvertisingSheet(cacheKey, value);
  }
}

export function getMemoryCachedProductAdvertisingSheet(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput,
) {
  const cacheKey = buildProductAdvertisingSheetCacheKey(nmId, input);
  return getMemoryCachedProductAdvertisingSheetByKey(cacheKey);
}

export function getCachedProductAdvertisingSheet(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput,
) {
  const cacheKey = buildProductAdvertisingSheetCacheKey(nmId, input);
  const memoryCached = getMemoryCachedProductAdvertisingSheet(nmId, input);
  if (memoryCached) {
    return memoryCached;
  }

  const latestSessionValue = readLatestProductAdvertisingSheetFromSessionStorage(cacheKey);
  if (latestSessionValue) {
    setMemoryCachedProductAdvertisingSheet(cacheKey, latestSessionValue);
    return latestSessionValue;
  }

  const persistedLocalValue = readLocalStorageProductAdvertisingSheet(cacheKey);
  if (persistedLocalValue) {
    setMemoryCachedProductAdvertisingSheet(cacheKey, persistedLocalValue);
    return persistedLocalValue;
  }

  return null;
}

export function invalidateCachedProductAdvertisingSheet(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput,
) {
  const cacheKey = buildProductAdvertisingSheetCacheKey(nmId, input);
  deleteMemoryCachedProductAdvertisingSheet(cacheKey);
  clearLatestProductAdvertisingSheetFromSessionStorage(cacheKey);
  clearLocalStorageProductAdvertisingSheet(cacheKey);
  void deleteProductAdvertisingSheetFromIndexedDb(cacheKey);
}

export async function getCachedProductAdvertisingSheetAsync(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput,
) {
  const syncValue = getCachedProductAdvertisingSheet(nmId, input);
  if (syncValue) {
    return syncValue;
  }

  const cacheKey = buildProductAdvertisingSheetCacheKey(nmId, input);
  const indexedDbValue = await readProductAdvertisingSheetFromIndexedDb(cacheKey);
  if (indexedDbValue) {
    setMemoryCachedProductAdvertisingSheet(cacheKey, indexedDbValue);
    return indexedDbValue;
  }

  return null;
}

export function readPreparedPresetSheetsForProduct(
  nmId: number,
  requestInputs: ProductAdvertisingSheetRequestInput[],
): PreparedProductAdvertisingSheetMap {
  const preparedSheets: PreparedProductAdvertisingSheetMap = {};

  for (const requestInput of requestInputs) {
    const requestKey = buildProductAdvertisingSheetRequestKey(nmId, requestInput);
    if (preparedSheets[requestKey]) {
      continue;
    }

    const cachedSheet = getCachedProductAdvertisingSheet(nmId, requestInput);
    if (cachedSheet) {
      preparedSheets[requestKey] = cachedSheet;
    }
  }

  return preparedSheets;
}

export async function readPreparedPresetSheetsForProductAsync(
  nmId: number,
  requestInputs: ProductAdvertisingSheetRequestInput[],
): Promise<PreparedProductAdvertisingSheetMap> {
  const preparedSheets: PreparedProductAdvertisingSheetMap = {};

  await Promise.all(
    requestInputs.map(async (requestInput) => {
      const requestKey = buildProductAdvertisingSheetRequestKey(nmId, requestInput);
      if (preparedSheets[requestKey]) {
        return;
      }

      const cachedSheet = await getCachedProductAdvertisingSheetAsync(nmId, requestInput);
      if (cachedSheet) {
        preparedSheets[requestKey] = cachedSheet;
      }
    }),
  );

  return preparedSheets;
}
