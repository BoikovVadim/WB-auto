import type { ProductAdvertisingSheetResponse } from "./syncClientTypes";
import { assertProductAdvertisingSheetResponse } from "./syncClientValidators";

const exportCacheDatabaseName = "wb-dashboard-cache";
const exportCacheStoreName = "saved-exports";
const productAdvertisingSheetCacheStoreName = "product-advertising-sheets";
const productAdvertisingSheetCacheSchemaVersion = 1;

type PersistedProductAdvertisingSheetRecord = {
  schemaVersion: number;
  cacheKey: string;
  value: ProductAdvertisingSheetResponse;
};

function isBrowserEnvironment() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openProductSnapshotCacheDatabase() {
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

export async function readProductAdvertisingSheetFromIndexedDb(cacheKey: string) {
  if (!isBrowserEnvironment()) {
    return null;
  }

  try {
    const database = await openProductSnapshotCacheDatabase();
    return await new Promise<ProductAdvertisingSheetResponse | null>((resolve, reject) => {
      const transaction = database.transaction(productAdvertisingSheetCacheStoreName, "readonly");
      const store = transaction.objectStore(productAdvertisingSheetCacheStoreName);
      const request = store.get(cacheKey);

      request.onsuccess = () => {
        const value = request.result as PersistedProductAdvertisingSheetRecord | undefined;
        if (
          !value ||
          value.cacheKey !== cacheKey ||
          value.schemaVersion !== productAdvertisingSheetCacheSchemaVersion
        ) {
          void deleteProductAdvertisingSheetFromIndexedDb(cacheKey);
          resolve(null);
          return;
        }

        try {
          assertProductAdvertisingSheetResponse(value.value);
          resolve(value.value);
        } catch {
          void deleteProductAdvertisingSheetFromIndexedDb(cacheKey);
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

export async function writeProductAdvertisingSheetToIndexedDb(
  cacheKey: string,
  value: ProductAdvertisingSheetResponse,
) {
  if (!isBrowserEnvironment()) {
    return;
  }

  try {
    const database = await openProductSnapshotCacheDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(productAdvertisingSheetCacheStoreName, "readwrite");
      const store = transaction.objectStore(productAdvertisingSheetCacheStoreName);
      store.put({
        schemaVersion: productAdvertisingSheetCacheSchemaVersion,
        cacheKey,
        value,
      } satisfies PersistedProductAdvertisingSheetRecord);
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

export async function deleteProductAdvertisingSheetFromIndexedDb(cacheKey: string) {
  if (!isBrowserEnvironment()) {
    return;
  }

  try {
    const database = await openProductSnapshotCacheDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(productAdvertisingSheetCacheStoreName, "readwrite");
      const store = transaction.objectStore(productAdvertisingSheetCacheStoreName);
      store.delete(cacheKey);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error("IndexedDB delete failed."));
      };
    });
  } catch {
    return;
  }
}
