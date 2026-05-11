import { useEffect, useMemo, useRef } from "react";

import {
  buildProductWorkspaceClusterQueriesCacheKey,
  getCachedProductWorkspaceClusterQueries,
} from "../../../api/productWorkspaceSlicesCache";
import {
  fetchProductAdvertisingWorkspaceClusterQueries,
  type ProductAdvertisingWorkspaceClusterRow,
  type ProductAdvertisingWorkspaceClusterSortDirection,
  type ProductAdvertisingWorkspaceClusterSortKey,
} from "../../../api/syncClient";
import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";

// Сколько верхних кластеров заранее грузим в фон.
// 100 — покрывает практически всё видимое содержимое таблицы,
// включая кластеры с 2000 запросами, которые иначе были бы медленными.
const clusterQueriesPrefetchLimit = 100;
// Параллельность: 16 одновременных запросов — браузер + HTTP/2
// дают максимальную утилизацию канала без перегрузки.
const clusterQueriesPrefetchConcurrency = 16;

/**
 * Заранее загружает запросы (queries) для первых N видимых кластеров.
 * Благодаря этому при раскрытии кластера пользователь видит данные
 * моментально: Эффект 2 в useProductAdvertisingClusterQueries находит
 * их в кеше и не делает сетевой запрос.
 */
export function useProductAdvertisingClusterQueriesPrefetch(input: {
  active: boolean;
  nmId: number | null;
  advertId: number | null;
  requestInput: ProductAdvertisingSheetRequestInput | null;
  visibleClusterRows: ProductAdvertisingWorkspaceClusterRow[];
  sortKey: ProductAdvertisingWorkspaceClusterSortKey;
  sortDirection: ProductAdvertisingWorkspaceClusterSortDirection;
}) {
  const visibleClusterRowsRef = useRef(input.visibleClusterRows);
  useEffect(() => {
    visibleClusterRowsRef.current = input.visibleClusterRows;
  });

  // Стабильная строка-ключ контекста: меняется только при смене кампании/дат/сортировки.
  const contextSignature = useMemo(
    () =>
      JSON.stringify({
        nmId: input.nmId,
        advertId: input.advertId,
        startDate: input.requestInput?.startDate ?? null,
        endDate: input.requestInput?.endDate ?? null,
        sortKey: input.sortKey,
        sortDirection: input.sortDirection,
      }),
    [input.advertId, input.nmId, input.requestInput, input.sortDirection, input.sortKey],
  );

  useEffect(() => {
    if (!input.active || input.nmId === null || input.advertId === null || !input.requestInput) {
      return;
    }

    const { nmId, advertId, requestInput, sortKey, sortDirection } = input;
    let isCancelled = false;

    // Запускаем prefetch без задержки: таблица уже отрисована к этому моменту
    // (эффект выполняется после paint), задержка только замедляла бы прогрев кеша.
    const clustersToPrefetch = visibleClusterRowsRef.current.slice(0, clusterQueriesPrefetchLimit);

    const prefetchOne = async (row: (typeof clustersToPrefetch)[number]) => {
        if (isCancelled) return;

        const cacheKey = buildProductWorkspaceClusterQueriesCacheKey({
          nmId,
          advertId,
          clusterKey: row.clusterKey,
          requestInput,
          sortKey,
          sortDirection,
        });

        if (getCachedProductWorkspaceClusterQueries(cacheKey)) {
          return; // Уже в кеше — пропускаем
        }

        try {
          await fetchProductAdvertisingWorkspaceClusterQueries({
            nmId,
            advertId,
            clusterKey: row.clusterKey,
            clusterName: row.clusterName,
            requestInput,
            sortKey,
            sortDirection,
          });
        } catch {
          // Prefetch-ошибки не блокируют UI — кластер загрузится при раскрытии.
        }
      };

    // Параллельные батчи по 16: кеш заполняется быстро, не перегружая браузер.
    const prefetch = async () => {
      for (let i = 0; i < clustersToPrefetch.length; i += clusterQueriesPrefetchConcurrency) {
        if (isCancelled) return;
        const batch = clustersToPrefetch.slice(i, i + clusterQueriesPrefetchConcurrency);
        await Promise.all(batch.map((row) => prefetchOne(row)));
      }
    };

    void prefetch();

    return () => {
      isCancelled = true;
    };
  // contextSignature кодирует весь контекст запроса. visibleClusterRows
  // читается через ref — избегаем лишних перезапусков при смене ссылки.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.active, contextSignature]);
}
