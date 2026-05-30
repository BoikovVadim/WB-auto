import { useEffect, useRef, useState } from "react";

import {
  fetchProductCatalog,
  getCachedProductCatalogResponse,
  type ProductCatalogItem,
} from "../../api/syncClient";
import { ui } from "./copy";
import { normalizeDashboardReadError } from "./dashboardErrors";

const productCatalogRefreshTtlMs = 5 * 60_000;
// Транзиентный сбой загрузки каталога (типичный — 502 в окне рестарта бэкенда после
// деплоя) раньше «сдавался» навсегда: эффект не перезапускался и список застревал на 0
// до ручного F5. Теперь ретраим с backoff (~2 мин суммарно покрывают окно деплоя).
const CATALOG_MAX_RETRIES = 8;
const CATALOG_RETRY_BASE_MS = 2_000;
const CATALOG_RETRY_MAX_MS = 30_000;

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
  // Счётчик попыток (ref — не триггерит ре-рендер) + тик для перезапуска эффекта-загрузки.
  const retryAttemptsRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryTick, setRetryTick] = useState(0);

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
        retryAttemptsRef.current = 0;
        setCatalogItems(response.items);
        setIsCatalogLoading(false);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        // Транзиентный сбой (напр. 502 в окне рестарта после деплоя): не сдаёмся и не
        // показываем «пусто» — держим загрузку и ретраим с backoff, данные подтянутся
        // сами без перезагрузки страницы.
        if (retryAttemptsRef.current < CATALOG_MAX_RETRIES) {
          const delay = Math.min(
            CATALOG_RETRY_MAX_MS,
            CATALOG_RETRY_BASE_MS * 2 ** retryAttemptsRef.current,
          );
          retryAttemptsRef.current += 1;
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => setRetryTick((tick) => tick + 1), delay);
          return;
        }
        setIsCatalogLoading(false);
        if (onError) {
          const nextError = normalizeDashboardReadError(error, ui.productsEmpty);
          if (nextError) {
            onError(nextError);
          }
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [active, cachedCatalog, onError, retryTick]);

  // Чистим таймер ретрая при размонтировании.
  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    },
    [],
  );

  return {
    productCatalogItems: catalogItems,
    isProductCatalogLoading: isCatalogLoading,
  };
}
