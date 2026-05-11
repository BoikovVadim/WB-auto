import type { ProductCatalogResponse } from "./syncClientTypes";
import { assertProductCatalogResponse } from "./syncClientValidators";

const productCatalogMemoryCacheKey = "product-catalog";
const productCatalogCacheStorageKey = "wb-dashboard-product-catalog";
const productCatalogMemoryCache = new Map<string, ProductCatalogResponse>();

function isWindowAvailable() {
  return typeof window !== "undefined";
}

export function cacheProductCatalogResponse(value: ProductCatalogResponse) {
  productCatalogMemoryCache.set(productCatalogMemoryCacheKey, value);
  if (!isWindowAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(productCatalogCacheStorageKey, JSON.stringify(value));
  } catch {
    return;
  }
}

export function getCachedProductCatalogResponse() {
  const memoryCached = productCatalogMemoryCache.get(productCatalogMemoryCacheKey);
  if (memoryCached) {
    return memoryCached;
  }

  if (!isWindowAvailable()) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(productCatalogCacheStorageKey);
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    assertProductCatalogResponse(parsedValue);
    productCatalogMemoryCache.set(productCatalogMemoryCacheKey, parsedValue);
    return parsedValue;
  } catch {
    return null;
  }
}
