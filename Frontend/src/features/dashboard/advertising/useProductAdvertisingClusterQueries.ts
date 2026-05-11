import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildProductWorkspaceClusterQueriesCacheKey,
  getCachedProductWorkspaceClusterQueries,
} from "../../../api/productWorkspaceSlicesCache";
import {
  fetchProductAdvertisingWorkspaceClusterQueries,
  type ProductAdvertisingWorkspaceClusterQueriesResponse,
  type ProductAdvertisingWorkspaceClusterSortDirection,
  type ProductAdvertisingWorkspaceClusterSortKey,
} from "../../../api/syncClient";
import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import { ui } from "../copy";
import { normalizeDashboardReadError } from "../dashboardErrors";
import {
  advertisingUxBudgetsMs,
  completeAdvertisingUxBudget,
  startAdvertisingUxBudget,
} from "./advertisingUxBudgets";

type ClusterQueriesState = {
  loading: boolean;
  error: string | null;
  data: ProductAdvertisingWorkspaceClusterQueriesResponse | null;
};

export function useProductAdvertisingClusterQueries(input: {
  active: boolean;
  nmId: number | null;
  advertId: number | null;
  requestInput: ProductAdvertisingSheetRequestInput | null;
  refreshKey?: number;
  expandedClusters: Array<{ key: string; clusterKey: string; clusterName: string }>;
  sortKey: ProductAdvertisingWorkspaceClusterSortKey;
  sortDirection: ProductAdvertisingWorkspaceClusterSortDirection;
}) {
  const {
    active,
    nmId,
    advertId,
    requestInput,
    refreshKey,
    expandedClusters,
    sortKey,
    sortDirection,
  } = input;
  const [queriesByClusterKey, setQueriesByClusterKey] = useState<Record<string, ClusterQueriesState>>({});
  const queriesByClusterKeyRef = useRef<Record<string, ClusterQueriesState>>({});

  // requestSignature — строковый ключ, кодирующий все поля requestInput и параметры
  // сортировки. Используется как стабильный dep вместо объекта requestInput.
  const requestSignature = useMemo(
    () =>
      JSON.stringify({
        nmId,
        advertId,
        startDate: requestInput?.startDate ?? null,
        endDate: requestInput?.endDate ?? null,
        sortKey,
        sortDirection,
        refreshKey: refreshKey ?? 0,
      }),
    [advertId, nmId, refreshKey, requestInput, sortDirection, sortKey],
  );

  // Ref хранит актуальный requestInput для чтения внутри эффектов без включения
  // объекта в deps — это исключает ложные перезапуски при смене ссылки без
  // изменения данных (startDate / endDate).
  const requestInputRef = useRef(requestInput);
  useEffect(() => {
    requestInputRef.current = requestInput;
  });

  useEffect(() => {
    queriesByClusterKeyRef.current = queriesByClusterKey;
  }, [queriesByClusterKey]);

  // Эффект 1: сбрасывает/синхронизирует стейт при смене контекста (кампания,
  // диапазон, сортировка, refreshKey). expandedClusters намеренно НЕ включён
  // в deps: раскрытие/скрытие кластеров обрабатывает Эффект 2.
  // Если добавить expandedClusters сюда, каждое раскрытие будет перезаписывать
  // весь стейт только кешированными данными, стирая loading:true у в-полёте
  // запросов и приводя к их бесконечному рестарту.
  useEffect(() => {
    if (!active || nmId === null || advertId === null || !requestInputRef.current) {
      setQueriesByClusterKey({});
      return;
    }

    const currentRequestInput = requestInputRef.current;

    // При смене контекста восстанавливаем из кеша то, что уже есть;
    // остальное Эффект 2 дозапросит.
    setQueriesByClusterKey((prevState) =>
      Object.fromEntries(
        expandedClusters.flatMap((cluster) => {
          const cacheKey = buildProductWorkspaceClusterQueriesCacheKey({
            nmId,
            advertId,
            clusterKey: cluster.clusterKey,
            requestInput: currentRequestInput,
            sortKey,
            sortDirection,
          });
          const cachedQueries = getCachedProductWorkspaceClusterQueries(cacheKey);
          if (cachedQueries) {
            completeAdvertisingUxBudget(
              buildClusterExpandBudgetKey(nmId, advertId, cluster.clusterKey, currentRequestInput),
            );
            return [
              [
                cluster.key,
                {
                  loading: false,
                  error: null,
                  data: cachedQueries,
                } satisfies ClusterQueriesState,
              ],
            ];
          }

          // Сохраняем in-flight загрузку: если запрос уже идёт (loading:true),
          // не сбрасываем его — пусть завершится.
          // Если есть старые загруженные данные (stale), оставляем их видимыми
          // пока Эффект 2 не загрузит свежие — кластер не "мигает" и не закрывается
          // при смене ранжирования.
          const existing = prevState[cluster.key];
          if (existing?.loading) {
            return [[cluster.key, existing]];
          }
          if (existing?.data) {
            return [[cluster.key, existing]];
          }

          return [];
        }),
      ),
    );
  // expandedClusters намеренно НЕ в deps (читается из замыкания render-фазы):
  // Эффект 1 реагирует только на смену контекста, раскрытие кластеров — Эффект 2.
  // requestSignature уже кодирует requestInput; объект requestInput убран из deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, advertId, nmId, requestSignature, sortDirection, sortKey]);

  // Эффект 2: загружает queries для раскрытых кластеров, которые ещё не имеют данных.
  useEffect(() => {
    if (!active || nmId === null || advertId === null || !requestInputRef.current) {
      return;
    }

    const currentRequestInput = requestInputRef.current;

    const pendingClusters = expandedClusters.filter((cluster) => {
      const currentValue = queriesByClusterKeyRef.current[cluster.key];
      return !currentValue || (!currentValue.loading && currentValue.data === null && currentValue.error === null);
    });

    if (pendingClusters.length === 0) {
      return;
    }

    let isCancelled = false;

    for (const cluster of pendingClusters) {
      const cacheKey = buildProductWorkspaceClusterQueriesCacheKey({
        nmId,
        advertId,
        clusterKey: cluster.clusterKey,
        requestInput: currentRequestInput,
        sortKey,
        sortDirection,
      });
      const cachedQueries = getCachedProductWorkspaceClusterQueries(cacheKey);
      if (cachedQueries) {
        completeAdvertisingUxBudget(
          buildClusterExpandBudgetKey(nmId, advertId, cluster.clusterKey, currentRequestInput),
        );
        setQueriesByClusterKey((currentValue) => ({
          ...currentValue,
          [cluster.key]: {
            loading: false,
            error: null,
            data: cachedQueries,
          },
        }));
        continue;
      }

      setQueriesByClusterKey((currentValue) => ({
        ...currentValue,
        [cluster.key]: {
          loading: true,
          error: null,
          data: null,
        },
      }));
      startAdvertisingUxBudget(
        buildClusterExpandBudgetKey(nmId, advertId, cluster.clusterKey, currentRequestInput),
        "cluster expand queries visible",
        advertisingUxBudgetsMs.repeatClusterExpand,
      );

      void fetchProductAdvertisingWorkspaceClusterQueries({
        nmId,
        advertId,
        clusterKey: cluster.clusterKey,
        clusterName: cluster.clusterName,
        requestInput: currentRequestInput,
        sortKey,
        sortDirection,
      })
        .then((response) => {
          if (isCancelled) {
            return;
          }

          setQueriesByClusterKey((currentValue) => ({
            ...currentValue,
            [cluster.key]: {
              loading: false,
              error: null,
              data: response,
            },
          }));
          completeAdvertisingUxBudget(
            buildClusterExpandBudgetKey(nmId, advertId, cluster.clusterKey, currentRequestInput),
          );
        })
        .catch((error) => {
          if (isCancelled) {
            return;
          }

          setQueriesByClusterKey((currentValue) => ({
            ...currentValue,
            [cluster.key]: {
              loading: false,
              error: normalizeDashboardReadError(error, ui.productAdvertisingClusterQueriesLoadError),
              data: null,
            },
          }));
        });
    }

    return () => {
      isCancelled = true;
    };
  // requestSignature — строковый ключ, уже кодирует requestInput (nmId, advertId,
  // startDate, endDate, sortKey, sortDirection, refreshKey). Объект requestInput
  // намеренно убран из deps: читается через requestInputRef, чтобы исключить
  // ложные перезапуски при смене ссылки без смены данных.
  }, [
    active,
    advertId,
    expandedClusters,
    nmId,
    refreshKey,
    requestSignature,
    sortDirection,
    sortKey,
  ]);

  return {
    productAdvertisingClusterQueriesByKey: queriesByClusterKey,
  };
}

function buildClusterExpandBudgetKey(
  nmId: number,
  advertId: number,
  clusterKey: string,
  requestInput: ProductAdvertisingSheetRequestInput,
) {
  return [
    "cluster-expand",
    String(nmId),
    String(advertId),
    clusterKey,
    requestInput.startDate,
    requestInput.endDate,
  ].join(":");
}
