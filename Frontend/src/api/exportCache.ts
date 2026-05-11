import type { WbExportResponse } from "./syncClientTypes";
import {
  assertExportHistoryResponse,
  assertExportMethodsResponse,
  assertExportResponse,
} from "./syncClientValidators";

const exportResponseMemoryCache = new Map<string, WbExportResponse>();
const exportCacheDatabaseName = "wb-dashboard-cache";
const exportCacheStoreName = "saved-exports";
const productAdvertisingSheetCacheStoreName = "product-advertising-sheets";
const exportMethodsCacheStorageKey = "wb-dashboard-export-methods";
const exportHistoryCacheStorageKey = "wb-dashboard-export-history";

function isBrowserEnvironment() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

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
    return null;
  }
}

function writeLocalStorageCache(storageKey: string, value: unknown) {
  if (!isWindowAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    return;
  }
}

function openExportCacheDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(exportCacheDatabaseName, 3);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(exportCacheStoreName)) {
        database.createObjectStore(exportCacheStoreName, {
          keyPath: "requestId",
        });
      }
      if (!database.objectStoreNames.contains(productAdvertisingSheetCacheStoreName)) {
        database.createObjectStore(productAdvertisingSheetCacheStoreName, {
          keyPath: "cacheKey",
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
  });
}

async function readExportResponseFromIndexedDb(requestId: string) {
  if (!isBrowserEnvironment()) {
    return null;
  }

  try {
    const database = await openExportCacheDatabase();
    return await new Promise<WbExportResponse | null>((resolve, reject) => {
      const transaction = database.transaction(exportCacheStoreName, "readonly");
      const store = transaction.objectStore(exportCacheStoreName);
      const request = store.get(requestId);

      request.onsuccess = () => {
        const value = request.result;
        if (!value) {
          resolve(null);
          return;
        }

        try {
          assertExportResponse(value);
          resolve(value);
        } catch {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed."));
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      };
    });
  } catch {
    return null;
  }
}

async function writeExportResponseToIndexedDb(value: WbExportResponse) {
  if (!isBrowserEnvironment()) {
    return;
  }

  try {
    const database = await openExportCacheDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(exportCacheStoreName, "readwrite");
      const store = transaction.objectStore(exportCacheStoreName);
      store.put(value);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error("IndexedDB write failed."));
      };
    });
  } catch {
    return;
  }
}

export async function cacheExportResponse(value: WbExportResponse) {
  exportResponseMemoryCache.set(value.requestId, value);
  await writeExportResponseToIndexedDb(value);
}

export function getCachedSavedExportSync(requestId: string) {
  return exportResponseMemoryCache.get(requestId) ?? null;
}

export async function getCachedSavedExport(requestId: string) {
  const memoryCached = exportResponseMemoryCache.get(requestId);
  if (memoryCached) {
    return memoryCached;
  }

  const persistedValue = await readExportResponseFromIndexedDb(requestId);
  if (persistedValue) {
    exportResponseMemoryCache.set(requestId, persistedValue);
  }

  return persistedValue;
}

export function cacheExportMethods(value: unknown) {
  writeLocalStorageCache(exportMethodsCacheStorageKey, value);
}

export function cacheExportHistory(value: unknown) {
  writeLocalStorageCache(exportHistoryCacheStorageKey, value);
}

export function getCachedExportMethods() {
  return readLocalStorageCache(exportMethodsCacheStorageKey, assertExportMethodsResponse);
}

export function getCachedExportHistory() {
  return readLocalStorageCache(exportHistoryCacheStorageKey, assertExportHistoryResponse);
}
