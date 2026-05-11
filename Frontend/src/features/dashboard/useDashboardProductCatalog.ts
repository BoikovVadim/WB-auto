import { useEffect, useRef, useState } from "react";

import {
  fetchProductCatalog,
  getCachedProductCatalogResponse,
  type ProductCatalogItem,
} from "../../api/syncClient";
import { ui } from "./copy";
import { normalizeDashboardReadError } from "./dashboardErrors";

const productCatalogRefreshTtlMs = 5 * 60_000;

function shouldRefreshProductCatalog(checkedAt: string | null | undefined) {
  if (!checkedAt) {
    return true;
  }

  const checkedAtMs = Date.parse(checkedAt);
  if (!Number.isFinite(checkedAtMs)) {
    return true;
  }

  return Date.now() - checkedAtMs > productCatalogRefreshTtlMs;
}

export function useDashboardProductCatalog(input: {
  active: boolean;
  onError?: (message: string) => void;
}) {
  const { active, onError } = input;
  const cachedCatalog = getCachedProductCatalogResponse();
  const [catalogItems, setCatalogItems] = useState<ProductCatalogItem[]>(cachedCatalog?.items ?? []);
  const [isCatalogLoading, setIsCatalogLoading] = useState(cachedCatalog === null);
  const catalogItemsRef = useRef(catalogItems);

  useEffect(() => {
    catalogItemsRef.current = catalogItems;
  }, [catalogItems]);

  useEffect(() => {
    if (!active) {
      return;
    }

    if (
      cachedCatalog &&
      catalogItemsRef.current.length > 0 &&
      !shouldRefreshProductCatalog(cachedCatalog.checkedAt)
    ) {
      setIsCatalogLoading(false);
      return;
    }

    let isCancelled = false;
    setIsCatalogLoading((currentValue) => currentValue || catalogItemsRef.current.length === 0);
    void fetchProductCatalog()
      .then((response) => {
        if (isCancelled) {
          return;
        }

        setCatalogItems(response.items);
      })
      .catch((error) => {
        if (isCancelled || !onError) {
          return;
        }

        const nextError = normalizeDashboardReadError(error, ui.productsEmpty);
        if (nextError) {
          onError(nextError);
        }
      })
      .finally(() => {
        if (isCancelled) {
          return;
        }

        setIsCatalogLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [active, cachedCatalog, onError]);

  return {
    productCatalogItems: catalogItems,
    isProductCatalogLoading: isCatalogLoading,
  };
}
