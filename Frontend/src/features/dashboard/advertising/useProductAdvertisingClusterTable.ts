import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildProductWorkspaceClusterTableCacheKey,
  getCachedProductWorkspaceClusterTable,
} from "../../../api/productWorkspaceSlicesCache";
import {
  fetchProductAdvertisingWorkspaceClusterTable,
  getEmptyClusterNumericFilters,
  type ProductAdvertisingWorkspaceClusterNumericFilters,
  type ProductAdvertisingWorkspaceClusterSortDirection,
  type ProductAdvertisingWorkspaceClusterSortKey,
  type ProductAdvertisingWorkspaceClusterStatusFilter,
  type ProductAdvertisingWorkspaceClusterTableResponse,
} from "../../../api/syncClient";
import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import { ui } from "../copy";
import { normalizeDashboardReadError } from "../dashboardErrors";

const EMPTY_NUMERIC_FILTERS = getEmptyClusterNumericFilters();

export function useProductAdvertisingClusterTable(input: {
  active: boolean;
  nmId: number | null;
  advertId: number | null;
  requestInput: ProductAdvertisingSheetRequestInput | null;
  search: string;
  status: ProductAdvertisingWorkspaceClusterStatusFilter;
  numericFilters?: ProductAdvertisingWorkspaceClusterNumericFilters;
  sortKey: ProductAdvertisingWorkspaceClusterSortKey;
  sortDirection: ProductAdvertisingWorkspaceClusterSortDirection;
  page: number;
  pageSize: number;
  refreshKey?: number;
  bootstrapTable?: ProductAdvertisingWorkspaceClusterTableResponse | null;
}) {
  const {
    active,
    nmId,
    advertId,
    requestInput,
    search,
    status,
    numericFilters = EMPTY_NUMERIC_FILTERS,
    sortKey,
    sortDirection,
    page,
    pageSize,
    refreshKey,
    bootstrapTable,
  } = input;
  const cacheKey = useMemo(
    () =>
      nmId !== null && advertId !== null
        ? buildProductWorkspaceClusterTableCacheKey({
            nmId,
            advertId,
            requestInput,
            search,
            status,
            numericFilters,
            sortKey,
            sortDirection,
            page,
            pageSize,
          })
        : null,
    [advertId, nmId, numericFilters, page, pageSize, requestInput, search, sortDirection, sortKey, status],
  );
  const [table, setTable] = useState<ProductAdvertisingWorkspaceClusterTableResponse | null>(
    () => (cacheKey ? getCachedProductWorkspaceClusterTable(cacheKey) : null) ?? bootstrapTable ?? null,
  );
  const tableRef = useRef(table);
  const prevCacheKeyRef = useRef<string | null>(cacheKey);
  const pollingTimerRef = useRef<number | null>(null);
  // Отслеживаем смену продукта/кампании vs смену только дат/фильтров.
  // При смене nmId/advertId — очищаем таблицу. При смене только дат —
  // оставляем старые данные (stale) и помечаем как refreshing.
  const prevNmIdRef = useRef<number | null>(nmId);
  const prevAdvertIdRef = useRef<number | null>(advertId);
  const [tableError, setTableError] = useState<string | null>(null);
  const [isTableLoading, setIsTableLoading] = useState(false);
  const [isTableRefreshing, setIsTableRefreshing] = useState(false);

  // Отслеживаем изменение refreshKey между рендерами — нужно отличать
  // оптимистичный патч кеша (не стреляем HTTP) от реальной инвалидации (стреляем).
  const prevRefreshKeyRef = useRef<number | undefined>(refreshKey);

  // Ref хранит последние fetch-параметры — нужен внутри эффекта без добавления
  // объектов requestInput/numericFilters/bootstrapTable в deps (они приводили к
  // бесконечным перезапускам при смене ссылки с теми же значениями).
  const fetchParamsRef = useRef({
    requestInput,
    search,
    status,
    numericFilters,
    sortKey,
    sortDirection,
    page,
    pageSize,
    bootstrapTable: bootstrapTable ?? null,
  });
  useEffect(() => {
    fetchParamsRef.current = {
      requestInput,
      search,
      status,
      numericFilters,
      sortKey,
      sortDirection,
      page,
      pageSize,
      bootstrapTable: bootstrapTable ?? null,
    };
  });

  useEffect(() => {
    tableRef.current = table;
  }, [table]);

  useEffect(() => {
    if (!active || nmId === null || advertId === null || !fetchParamsRef.current.requestInput) {
      setTable(null);
      setTableError(null);
      setIsTableLoading(false);
      setIsTableRefreshing(false);
      return;
    }

    const { bootstrapTable: currentBootstrap } = fetchParamsRef.current;
    const cachedTable = cacheKey ? getCachedProductWorkspaceClusterTable(cacheKey) : null;
    const cacheKeyChanged = prevCacheKeyRef.current !== cacheKey;
    prevCacheKeyRef.current = cacheKey;
    // Смена продукта/кампании — очищаем таблицу чтобы не показывать данные чужой РК.
    // Смена дат/фильтров — оставляем stale-данные видимыми (stale-while-revalidate):
    // новые данные подменяются на месте без мигания таблицы.
    const entityChanged =
      prevNmIdRef.current !== nmId || prevAdvertIdRef.current !== advertId;
    prevNmIdRef.current = nmId;
    prevAdvertIdRef.current = advertId;
    const refreshKeyChanged = prevRefreshKeyRef.current !== refreshKey;
    prevRefreshKeyRef.current = refreshKey;
    setTable((currentValue) => {
      if (cachedTable) return cachedTable;
      if (currentBootstrap) return currentBootstrap;
      if (cacheKeyChanged && entityChanged) return null;
      if (cacheKeyChanged) return currentValue ?? null;
      return currentValue ?? null;
    });
    setTableError(null);

    let isCancelled = false;
    // При смене дат/фильтров показываем stale-данные как refreshing, без пустого экрана.
    const staleTable = !entityChanged ? tableRef.current : null;
    const hasUsableTable = Boolean(cachedTable ?? currentBootstrap ?? staleTable);
    // Всегда показываем скелетон когда нет данных, независимо от in-flight состояния.
    // Раньше подавляли isTableLoading когда запрос уже летит (чтобы не мигал спиннер),
    // но это приводило к белому экрану при долгом PATH B. Скелетон лучше белого экрана.
    setIsTableLoading(!hasUsableTable);
    // При прямом попадании в memory cache данные уже актуальны — не затемняем таблицу
    // и не блокируем pointer-events. Фоновый запрос всё равно отправляется для
    // обновления данных, но пользователь может работать с таблицей немедленно.
    // Overlay «refreshing» (opacity 0.45, pointer-events: none) включаем только
    // когда показываем stale-данные (bootstrap или предыдущий период того же товара).
    setIsTableRefreshing(hasUsableTable && cachedTable === null);
    // Пропускаем полный запрос только если bootstrap уже содержит ВСЕ строки.
    // Если bootstrap частичный (rows.length < totalRows — например, 9 из 73),
    // запускаем полный запрос чтобы загрузить недостающие строки.
    const bootstrapIsComplete =
      currentBootstrap !== null &&
      currentBootstrap.rows.length >= currentBootstrap.pagination.totalRows;
    const shouldSkipBootstrapFetch =
      bootstrapIsComplete &&
      cachedTable === null &&
      tableRef.current === null &&
      (refreshKey ?? 0) === 0;
    if (shouldSkipBootstrapFetch) {
      setIsTableLoading(false);
      setIsTableRefreshing(false);
      return;
    }

    const doFetch = () => {
      const {
        requestInput: currentRequestInput,
        search: currentSearch,
        status: currentStatus,
        numericFilters: currentNumericFilters,
        sortKey: currentSortKey,
        sortDirection: currentSortDirection,
        page: currentPage,
        pageSize: currentPageSize,
      } = fetchParamsRef.current;

      void fetchProductAdvertisingWorkspaceClusterTable({
        nmId,
        advertId,
        requestInput: currentRequestInput,
        search: currentSearch,
        status: currentStatus,
        numericFilters: currentNumericFilters,
        sortKey: currentSortKey,
        sortDirection: currentSortDirection,
        page: currentPage,
        pageSize: currentPageSize,
      })
        .then((response) => {
          if (isCancelled) return;

          // Backend is still building data (PATH B). Poll every 3 seconds until ready.
          if (response.readiness?.status === "materialization_pending") {
            pollingTimerRef.current = window.setTimeout(doFetch, 3000);
            return;
          }

          setTable(response);
          setTableError(null);
          setIsTableLoading(false);
          setIsTableRefreshing(false);
        })
        .catch((error) => {
          if (isCancelled) return;

          // Если есть stale-данные или bootstrap — молча сбрасываем refresh-флаг
          // без показа ошибки: пользователь видит актуальный кеш, а не сообщение
          // о таймауте. Ошибку показываем только когда данных вообще нет.
          const hasUsableData =
            tableRef.current !== null || fetchParamsRef.current.bootstrapTable !== null;
          if (!hasUsableData) {
            setTableError(normalizeDashboardReadError(error, ui.productAdvertisingClusterTableLoadError));
          }
          setIsTableLoading(false);
          setIsTableRefreshing(false);
        });
    };

    // Оптимистичный патч кеша: refreshKey сменился, но cacheKey не изменился
    // и в памяти уже есть свежие данные (только что записанные патчем).
    // Сетевой запрос в этом случае вернул бы старое состояние сервера и откатил
    // бы оптимистичный UI — пропускаем его. Второй onReloadSheet (после завершения
    // API-вызова) очистит кеш, и тогда эффект отправит запрос за актуальными данными.
    const isOptimisticCacheRead = refreshKeyChanged && !cacheKeyChanged && cachedTable !== null;
    if (!isOptimisticCacheRead) {
      doFetch();
    }

    return () => {
      isCancelled = true;
      if (pollingTimerRef.current !== null) {
        clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  // cacheKey — строковый ключ, уже кодирует requestInput, numericFilters и все
  // остальные параметры запроса. Объекты requestInput/numericFilters/bootstrapTable
  // намеренно убраны из deps: их значения читаются через fetchParamsRef, что
  // исключает ложные перезапуски при смене ссылки без смены данных.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, nmId, advertId, cacheKey, refreshKey]);

  // Используем bootstrapTable как fallback: при первом рендере detail-режима
  // state ещё null (инициализировался в list-режиме), но bootstrapWorkspace уже
  // несёт initialClusterTable → отображаем его моментально без ожидания эффекта.
  const displayTable = table ?? bootstrapTable ?? null;
  const displayIsLoading = isTableLoading && displayTable === null;
  return {
    productAdvertisingClusterTable: displayTable,
    productAdvertisingClusterTableError: tableError,
    isProductAdvertisingClusterTableLoading: displayIsLoading,
    isProductAdvertisingClusterTableRefreshing: isTableRefreshing,
  };
}
