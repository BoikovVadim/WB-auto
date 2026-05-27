import {
  buildProductAdvertisingSheetCacheKey,
  buildProductAdvertisingSheetRequestKey,
  type ProductAdvertisingSheetRequestInput,
} from "./productAdvertisingSheetIdentity";
import type { ProductAdvertisingSheetResponse } from "./syncClientTypes";
import {
  deleteMemoryCachedProductAdvertisingSheet,
  getMemoryCachedProductAdvertisingSheetByKey,
  setMemoryCachedProductAdvertisingSheet,
  type PreparedProductAdvertisingSheetMap,
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
  void options;
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
  const memoryCached = getMemoryCachedProductAdvertisingSheet(nmId, input);
  if (memoryCached) {
    return memoryCached;
  }

  return null;
}

export function invalidateCachedProductAdvertisingSheet(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput,
) {
  const cacheKey = buildProductAdvertisingSheetCacheKey(nmId, input);
  deleteMemoryCachedProductAdvertisingSheet(cacheKey);
}

export async function getCachedProductAdvertisingSheetAsync(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput,
) {
  return getCachedProductAdvertisingSheet(nmId, input);
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
