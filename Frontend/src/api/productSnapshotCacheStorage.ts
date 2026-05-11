import type { ProductAdvertisingSheetResponse } from "./syncClientTypes";
import { assertProductAdvertisingSheetResponse } from "./syncClientValidators";

const latestProductAdvertisingSheetSessionStorageKey =
  "wb-dashboard-latest-product-advertising-sheet";
const productAdvertisingSheetMemoryCache = new Map<string, ProductAdvertisingSheetResponse>();

type PersistedLatestProductAdvertisingSheet = {
  key: string;
  value: ProductAdvertisingSheetResponse;
};

export type PreparedProductAdvertisingSheetMap = Record<
  string,
  ProductAdvertisingSheetResponse
>;

function isWindowAvailable() {
  return typeof window !== "undefined";
}

function readLocalStorageCache<T>(
  storageKey: string,
  assertValue: (value: unknown) => asserts value is T,
) {
  if (!isWindowAvailable()) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    assertValue(parsedValue);
    return parsedValue;
  } catch {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      return null;
    }
    return null;
  }
}

export function writeLocalStorageProductAdvertisingSheet(
  storageKey: string,
  value: ProductAdvertisingSheetResponse,
) {
  if (!isWindowAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    return;
  }
}

export function readLocalStorageProductAdvertisingSheet(storageKey: string) {
  return readLocalStorageCache(storageKey, assertProductAdvertisingSheetResponse);
}

export function getMemoryCachedProductAdvertisingSheetByKey(cacheKey: string) {
  return productAdvertisingSheetMemoryCache.get(cacheKey) ?? null;
}

export function setMemoryCachedProductAdvertisingSheet(
  cacheKey: string,
  value: ProductAdvertisingSheetResponse,
) {
  productAdvertisingSheetMemoryCache.set(cacheKey, value);
}

export function deleteMemoryCachedProductAdvertisingSheet(cacheKey: string) {
  productAdvertisingSheetMemoryCache.delete(cacheKey);
}

export function writeLatestProductAdvertisingSheetToSessionStorage(
  key: string,
  value: ProductAdvertisingSheetResponse,
) {
  if (!isWindowAvailable()) {
    return;
  }

  try {
    const persistedValue: PersistedLatestProductAdvertisingSheet = {
      key,
      value,
    };
    window.sessionStorage.setItem(
      latestProductAdvertisingSheetSessionStorageKey,
      JSON.stringify(persistedValue),
    );
  } catch {
    return;
  }
}

export function readLatestProductAdvertisingSheetFromSessionStorage(expectedKey: string) {
  if (!isWindowAvailable()) {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(
      latestProductAdvertisingSheetSessionStorageKey,
    );
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as PersistedLatestProductAdvertisingSheet;
    if (!parsedValue || typeof parsedValue !== "object" || parsedValue.key !== expectedKey) {
      return null;
    }

    assertProductAdvertisingSheetResponse(parsedValue.value);
    return parsedValue.value;
  } catch {
    try {
      window.sessionStorage.removeItem(latestProductAdvertisingSheetSessionStorageKey);
    } catch {
      return null;
    }
    return null;
  }
}

export function clearLatestProductAdvertisingSheetFromSessionStorage(expectedKey: string) {
  if (!isWindowAvailable()) {
    return;
  }

  try {
    const rawValue = window.sessionStorage.getItem(
      latestProductAdvertisingSheetSessionStorageKey,
    );
    if (!rawValue) {
      return;
    }

    const parsedValue = JSON.parse(rawValue) as PersistedLatestProductAdvertisingSheet;
    if (!parsedValue || typeof parsedValue !== "object" || parsedValue.key !== expectedKey) {
      return;
    }

    window.sessionStorage.removeItem(latestProductAdvertisingSheetSessionStorageKey);
  } catch {
    return;
  }
}

export function clearLocalStorageProductAdvertisingSheet(storageKey: string) {
  if (!isWindowAvailable()) {
    return;
  }

  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    return;
  }
}
