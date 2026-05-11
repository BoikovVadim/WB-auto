import { useCallback, useEffect, useMemo } from "react";

import { fetchProductAdvertisingWorkspaceClusterTable } from "../../../api/syncClientAdvertisingRead";
import type {
  ProductAdvertisingWorkspaceResponse,
} from "../../../api/syncClient";
import {
  buildAdvertisingClusterGroupKey,
  buildAdvertisingClusterWidths,
} from "./clusterTableView";
import type { AdvertisingDateRange } from "./date";
import { formatCalendarDateValue } from "./date";
import {
  isClusterActive,
  isClusterExcluded,
} from "./model";
import {
  hasAdvertisingNumericFilters,
  matchesAdvertisingNumericFilters,
} from "./advertisingModelFilters";
import { advertisingClusterNumericFilterKeys } from "./clusterTableView";
import { compareWorkspaceClusterRows } from "./productWorkspaceLocalView";
import { isTransientActionSyncStatus } from "./snapshot";
import { useAdvertisingCampaignSelection } from "./useAdvertisingCampaignSelection";
import { useAdvertisingClusterColumnOrderState } from "./useAdvertisingClusterColumnOrderState";
import { useAdvertisingClusterGroupSelection } from "./useAdvertisingClusterGroupSelection";
import { useAdvertisingClusterTableControls } from "./useAdvertisingClusterTableControls";
import {
  computeClusterTotalsFromRows,
  getEmptyAdvertisingClusterTotals,
} from "./advertisingClusterTableTotals";
import type { ProductAdvertisingDetailRevisions } from "./productAdvertisingDetailInvalidation";
import { resolveEffectiveProductAdvertisingRequestInput } from "./productAdvertisingResolvedRange";
import { useProductAdvertisingClusterQueries } from "./useProductAdvertisingClusterQueries";
import { useProductAdvertisingClusterQueriesPrefetch } from "./useProductAdvertisingClusterQueriesPrefetch";
import { useProductAdvertisingClusterTable } from "./useProductAdvertisingClusterTable";

export function useProductAdvertisingClusterTableState(input: {
  nmId: number | null;
  detailRevisions: ProductAdvertisingDetailRevisions;
  workspace: ProductAdvertisingWorkspaceResponse | null;
  dateRange: AdvertisingDateRange;
}) {
  const { nmId, detailRevisions, workspace, dateRange } = input;
  const clusterTableRequestInput = useMemo(
    () => {
      const preferredRequestInput =
        dateRange.start && dateRange.end
          ? {
              startDate: formatCalendarDateValue(dateRange.start),
              endDate: formatCalendarDateValue(dateRange.end),
            }
          : null;

      return resolveEffectiveProductAdvertisingRequestInput({
        preferredRequestInput,
        workspace,
      });
    },
    [
      dateRange.end,
      dateRange.start,
      workspace,
    ],
  );
  const {
    campaignSummaries,
    clusterDailyStatsBounds,
    selectedCampaign,
    setSelectedCampaignId,
  } = useAdvertisingCampaignSelection(workspace);
  const {
    clusterSearch,
    setClusterSearch,
    numericFilters,
    statusFilter,
    setStatusFilter,
    sortState,
    deferredClusterSearch,
    page,
    pageSize,
    setPage,
    handleSortChange,
    handleNumericFilterChange,
    applyNumericFilter,
  } = useAdvertisingClusterTableControls({
    selectedCampaignAdvertId: selectedCampaign?.advertId ?? null,
    tableRefreshKey: detailRevisions.table,
  });
  const {
    draggedAdvertisingColumn,
    orderedAdvertisingColumns,
    setDraggedAdvertisingColumn,
    handleAdvertisingColumnDrop,
  } = useAdvertisingClusterColumnOrderState();
  const bootstrapClusterTable = useMemo(() => {
    if (!workspace?.initialClusterTable || !selectedCampaign || clusterTableRequestInput === null) {
      return null;
    }

    // Bootstrap (workspace.initialClusterTable) построен за период workspace.range.
    // Если пользователь выбрал другой диапазон дат, bootstrap содержит данные за
    // ДРУГОЙ период — использовать его нельзя, иначе покажутся некорректные цифры.
    const workspaceRange = workspace.range;
    const datesMatchWorkspace =
      workspaceRange != null &&
      clusterTableRequestInput.startDate === workspaceRange.startDate &&
      clusterTableRequestInput.endDate === workspaceRange.endDate;
    if (!datesMatchWorkspace) {
      return null;
    }

    const initialTable = workspace.initialClusterTable;
    // Bootstrap валиден для любого statusFilter: мы всегда запрашиваем
    // status:"all" на сервер, а фильтрация по active/excluded — клиентская.
    const isDefaultRequest =
      deferredClusterSearch.trim().length === 0 &&
      sortState.key === "spend" &&
      sortState.direction === "desc" &&
      page === 1 &&
      pageSize === initialTable.pagination.pageSize;
    if (!isDefaultRequest || initialTable.advertId !== selectedCampaign.advertId) {
      return null;
    }

    return initialTable;
  }, [
    clusterTableRequestInput,
    deferredClusterSearch,
    page,
    pageSize,
    selectedCampaign,
    sortState.direction,
    sortState.key,
    workspace?.initialClusterTable,
    workspace?.range,
  ]);
  // Фоновый prefetch таблиц для ВСЕХ остальных кампаний товара при входе/смене дат.
  // Гарантирует мгновенное переключение между РК: к моменту клика данные уже в кеше.
  // Использует АКТУАЛЬНЫЙ clusterTableRequestInput (с учётом выбранного пользователем
  // диапазона дат), а не дефолтный период воркспейса.
  // Stable string key: re-runs only when the actual set of advertIds or the date
  // range changes, not on every re-render that recreates the campaignSummaries array.
  const campaignAdvertIdsKey = useMemo(
    () => campaignSummaries.map((c) => c.advertId).sort().join(","),
    [campaignSummaries],
  );
  const clusterTableRequestInputKey = JSON.stringify(clusterTableRequestInput);
  useEffect(() => {
    if (!nmId || !clusterTableRequestInput || !campaignSummaries.length) return;

    for (const campaign of campaignSummaries) {
      if (campaign.advertId === selectedCampaign?.advertId) continue;
      void fetchProductAdvertisingWorkspaceClusterTable({
        nmId,
        advertId: campaign.advertId,
        requestInput: clusterTableRequestInput,
        sortKey: "spend",
        sortDirection: "desc",
        pageSize: 5000,
      }).catch(() => null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nmId, clusterTableRequestInputKey, campaignAdvertIdsKey, selectedCampaign?.advertId]);

  const {
    productAdvertisingClusterTable,
    productAdvertisingClusterTableError,
    isProductAdvertisingClusterTableLoading,
    isProductAdvertisingClusterTableRefreshing,
  } = useProductAdvertisingClusterTable({
    active: nmId !== null && selectedCampaign !== null && clusterTableRequestInput !== null,
    nmId,
    advertId: selectedCampaign?.advertId ?? null,
    requestInput: clusterTableRequestInput,
    search: deferredClusterSearch,
    // Числовые фильтры, status и сортировка применяются клиентски (см. visibleClusterRows).
    // Бэкенд всегда возвращает все строки в дефолтном порядке — один кэш-ключ на запрос.
    status: "all",
    sortKey: "spend",
    sortDirection: "desc",
    page,
    pageSize,
    refreshKey: detailRevisions.table,
    bootstrapTable: bootstrapClusterTable,
  });

  const allClusterRows = useMemo(
    () => productAdvertisingClusterTable?.rows ?? [],
    [productAdvertisingClusterTable],
  );
  // Клиентские фильтрация и сортировка: без запроса на бэкенд при смене фильтров/сортировки.
  const visibleClusterRows = useMemo(() => {
    let rows = allClusterRows;
    if (statusFilter === "active") rows = rows.filter(isClusterActive);
    else if (statusFilter === "excluded") rows = rows.filter(isClusterExcluded);
    if (hasAdvertisingNumericFilters(numericFilters, advertisingClusterNumericFilterKeys)) {
      rows = rows.filter((row) =>
        matchesAdvertisingNumericFilters(row, numericFilters, advertisingClusterNumericFilterKeys),
      );
    }
    if (sortState.key !== "spend" || sortState.direction !== "desc") {
      rows = [...rows].sort((left, right) =>
        compareWorkspaceClusterRows(left, right, sortState.key, sortState.direction),
      );
    }
    return rows;
  }, [allClusterRows, statusFilter, numericFilters, sortState.key, sortState.direction]);
  const advertisingColumnWidths = useMemo(
    () =>
      buildAdvertisingClusterWidths(
        productAdvertisingClusterTable?.rows ?? visibleClusterRows,
        orderedAdvertisingColumns,
      ),
    [orderedAdvertisingColumns, productAdvertisingClusterTable?.rows, visibleClusterRows],
  );
  // Счётчики кластеров берём ТОЛЬКО из загруженной таблицы за актуальный период.
  // rowsCount из workspace нельзя использовать как fallback: workspace строится за
  // свой период дат, а таблица кластеров — за выбранный пользователем период.
  // При несовпадении показывался бы неверный счётчик (748→306).
  // При смене кампании или пока таблица не загружена — показываем 0.
  const isTableForCurrentCampaign =
    productAdvertisingClusterTable?.advertId === selectedCampaign?.advertId;
  const clusterFilterCounts =
    (isTableForCurrentCampaign ? productAdvertisingClusterTable?.filterCounts : null) ??
    { all: 0, active: 0, excluded: 0 };
  const isClusterTableLoading = isProductAdvertisingClusterTableLoading;
  const {
    expandedClusterKeys,
    selectedClusterKeys,
    selectedClusterRows,
    allVisibleClustersSelected,
    setSelectedClusterKeys,
    toggleClusterGroup,
    toggleSelectedClusterGroup,
    toggleSelectAllClusterGroups,
  } = useAdvertisingClusterGroupSelection(
    visibleClusterRows,
    productAdvertisingClusterTable?.rows ?? visibleClusterRows,
  );
  const expandedClusterDescriptors = useMemo(
    () =>
      visibleClusterRows
        .filter((row) => expandedClusterKeys.includes(buildAdvertisingClusterGroupKey(row)))
        .map((row) => ({
          key: buildAdvertisingClusterGroupKey(row),
          clusterKey: row.clusterKey,
          clusterName: row.clusterName,
        })),
    [expandedClusterKeys, visibleClusterRows],
  );
  const { productAdvertisingClusterQueriesByKey } = useProductAdvertisingClusterQueries({
    active: nmId !== null && selectedCampaign !== null && clusterTableRequestInput !== null,
    nmId,
    advertId: selectedCampaign?.advertId ?? null,
    requestInput: clusterTableRequestInput,
    refreshKey: detailRevisions.queries,
    expandedClusters: expandedClusterDescriptors,
    sortKey: sortState.key,
    sortDirection: sortState.direction,
  });
  // Фоновый prefetch запросов для первых видимых кластеров — чтобы при
  // раскрытии данные брались из кеша моментально.
  useProductAdvertisingClusterQueriesPrefetch({
    active: nmId !== null && selectedCampaign !== null && clusterTableRequestInput !== null,
    nmId,
    advertId: selectedCampaign?.advertId ?? null,
    requestInput: clusterTableRequestInput,
    visibleClusterRows,
    sortKey: sortState.key,
    sortDirection: sortState.direction,
  });
  const clusterRowByKey = useMemo(
    () =>
      new Map(
        visibleClusterRows.map((row) => [buildAdvertisingClusterGroupKey(row), row]),
      ),
    [visibleClusterRows],
  );
  // Итоги пересчитываются по видимым строкам при любом клиентском фильтре.
  const visibleClusterTotals = useMemo(() => {
    const currency = selectedCampaign?.currency ?? null;
    if (!productAdvertisingClusterTable) {
      return getEmptyAdvertisingClusterTotals(currency);
    }
    const hasClientFilter =
      statusFilter !== "all" ||
      hasAdvertisingNumericFilters(numericFilters, advertisingClusterNumericFilterKeys);
    if (hasClientFilter) {
      return computeClusterTotalsFromRows(visibleClusterRows, currency);
    }
    return productAdvertisingClusterTable.totals;
  }, [productAdvertisingClusterTable, statusFilter, numericFilters, visibleClusterRows, selectedCampaign?.currency]);
  const selectedActiveClustersCount = selectedClusterRows.filter((row) =>
    isClusterActive(row),
  ).length;
  const selectedExcludedClustersCount = selectedClusterRows.filter((row) =>
    isClusterExcluded(row),
  ).length;
  const hasSelectedPendingClusterActions = selectedClusterRows.some((row) =>
    isTransientActionSyncStatus(row.actionSyncStatus),
  );
  const canSubmitClusterAction =
    nmId !== null && selectedCampaign?.advertId !== null && selectedClusterRows.length > 0;

  const pagination = useMemo(() => ({
    page: productAdvertisingClusterTable?.pagination.page ?? 1,
    pageSize: productAdvertisingClusterTable?.pagination.pageSize ?? pageSize,
    // Фильтрация клиентская — pagination отражает отфильтрованное число строк.
    totalRows: visibleClusterRows.length,
    totalPages: Math.max(1, Math.ceil(visibleClusterRows.length / pageSize)),
  }), [
    productAdvertisingClusterTable?.pagination.page,
    productAdvertisingClusterTable?.pagination.pageSize,
    pageSize,
    visibleClusterRows.length,
  ]);

  const handlePageChange = useCallback((nextPage: number) => {
    setPage(nextPage);
  }, [setPage]);

  return {
    clusterTableRequestInput,
    campaignSummaries,
    clusterDailyStatsBounds,
    selectedCampaign,
    statusFilter,
    setStatusFilter,
    clusterFilterCounts,
    isClusterTableLoading,
    isClusterTableRefreshing: isProductAdvertisingClusterTableRefreshing,
    visibleClusterRows,
    orderedAdvertisingColumns,
    advertisingColumnWidths,
    sortState,
    draggedAdvertisingColumn,
    setDraggedAdvertisingColumn,
    handleAdvertisingColumnDrop,
    handleSortChange,
    allVisibleClustersSelected,
    toggleSelectAllClusterGroups,
    clusterSearch,
    setClusterSearch,
    numericFilters,
    handleNumericFilterChange,
    applyNumericFilter,
    visibleClusterTotals,
    pagination,
    expandedClusterKeys,
    selectedClusterKeys,
    clearSelectedClusterKeys: useCallback(() => {
      setSelectedClusterKeys([]);
    }, [setSelectedClusterKeys]),
    toggleSelectedClusterGroup,
    toggleClusterGroup,
    productAdvertisingClusterQueriesByKey,
    selectedCampaignAdvertId: selectedCampaign?.advertId ?? null,
    onSelectCampaign: setSelectedCampaignId,
    onPageChange: handlePageChange,
    selectedClusterRows,
    selectedActiveClustersCount,
    selectedExcludedClustersCount,
    hasSelectedPendingClusterActions,
    canSubmitClusterAction,
    clusterTableError: productAdvertisingClusterTableError,
    clusterRowByKey,
  };
}

