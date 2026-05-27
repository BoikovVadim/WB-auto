import { useCallback, useEffect, useMemo, useState } from "react";

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
  toProductAdvertisingWorkspaceNumericFilters,
} from "./advertisingModelFilters";
import { advertisingClusterNumericFilterKeys } from "./clusterTableView";
import { isTransientActionSyncStatus } from "./snapshot";
import { useAdvertisingCampaignSelection } from "./useAdvertisingCampaignSelection";
import { useAdvertisingClusterColumnOrderState } from "./useAdvertisingClusterColumnOrderState";
import { useAdvertisingClusterNameWidthState } from "./useAdvertisingClusterNameWidthState";
import { useAdvertisingClusterGroupSelection } from "./useAdvertisingClusterGroupSelection";
import { useAdvertisingClusterTableControls } from "./useAdvertisingClusterTableControls";
import {
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
  const [clusterFilterCountsByAdvert, setClusterFilterCountsByAdvert] = useState<
    Map<number, { all: number; active: number; excluded: number }>
  >(new Map());

  useEffect(() => {
    setClusterFilterCountsByAdvert(new Map());
  }, [nmId]);
  const clusterTableRequestInput = useMemo(
    () => {
      const preferredRequestInput =
        dateRange.start || dateRange.end
          ? {
              // Нормализуем неполный диапазон (выбрана только одна дата):
              // используем её же как start/end, чтобы запрос РК всегда
              // переключался вместе с календарём и не залипал на workspace.range.
              startDate: formatCalendarDateValue(dateRange.start ?? dateRange.end ?? new Date()),
              endDate: formatCalendarDateValue(dateRange.end ?? dateRange.start ?? new Date()),
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
    selectedCampaignId,
    setSelectedCampaignId,
  } = useAdvertisingCampaignSelection(nmId, workspace);
  const {
    clusterSearch,
    setClusterSearch,
    clusterNameSearch,
    setClusterNameSearch,
    deferredClusterNameSearch,
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
    productNmId: nmId,
    selectedCampaignAdvertId: selectedCampaign?.advertId ?? null,
    tableRefreshKey: detailRevisions.table,
  });
  const {
    draggedAdvertisingColumn,
    orderedAdvertisingColumns,
    setDraggedAdvertisingColumn,
    handleAdvertisingColumnDrop,
  } = useAdvertisingClusterColumnOrderState();
  const { clusterNameWidth, handleClusterNameWidthChange } = useAdvertisingClusterNameWidthState();
  const requestNumericFilters = useMemo(
    () => toProductAdvertisingWorkspaceNumericFilters(numericFilters),
    [numericFilters],
  );
  // Allow the cluster table fetch to start in parallel with the workspace request
  // for returning users: selectedCampaignId is already in sessionStorage so we
  // don't have to wait for workspace.campaignTabs to arrive first.
  // Falls back to selectedCampaign (resolved from workspace) for first-time visits.
  const effectiveAdvertId = selectedCampaign?.advertId ?? selectedCampaignId;
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
    const isDefaultRequest =
      deferredClusterSearch.trim().length === 0 &&
      deferredClusterNameSearch.trim().length === 0 &&
      !hasAdvertisingNumericFilters(numericFilters, advertisingClusterNumericFilterKeys) &&
      statusFilter === initialTable.appliedFilters.status &&
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
    deferredClusterNameSearch,
    numericFilters,
    page,
    pageSize,
    selectedCampaign,
    statusFilter,
    sortState.direction,
    sortState.key,
    workspace,
  ]);
  const {
    productAdvertisingClusterTable,
    productAdvertisingClusterTableError,
    isProductAdvertisingClusterTableLoading,
    isProductAdvertisingClusterTableRefreshing,
  } = useProductAdvertisingClusterTable({
    active: nmId !== null && effectiveAdvertId !== null && clusterTableRequestInput !== null,
    nmId,
    advertId: effectiveAdvertId,
    requestInput: clusterTableRequestInput,
    search: deferredClusterSearch,
    clusterNameSearch: deferredClusterNameSearch,
    status: statusFilter,
    numericFilters: requestNumericFilters,
    sortKey: sortState.key,
    sortDirection: sortState.direction,
    page,
    pageSize,
    refreshKey: detailRevisions.table,
    bootstrapTable: bootstrapClusterTable,
  });

  const visibleClusterRows = useMemo(
    () => productAdvertisingClusterTable?.rows ?? [],
    [productAdvertisingClusterTable],
  );
  const advertisingColumnWidths = useMemo(() => {
    const widths = buildAdvertisingClusterWidths(
      productAdvertisingClusterTable?.rows ?? visibleClusterRows,
      orderedAdvertisingColumns,
    );
    if (clusterNameWidth !== null) {
      return { ...widths, clusterName: clusterNameWidth };
    }
    return widths;
  }, [orderedAdvertisingColumns, productAdvertisingClusterTable?.rows, visibleClusterRows, clusterNameWidth]);
  useEffect(() => {
    if (!productAdvertisingClusterTable) {
      return;
    }
    setClusterFilterCountsByAdvert((currentValue) => {
      const nextValue = new Map(currentValue);
      nextValue.set(
        productAdvertisingClusterTable.advertId,
        productAdvertisingClusterTable.filterCounts,
      );
      return nextValue;
    });
  }, [productAdvertisingClusterTable]);

  // Счётчики кластеров:
  // 1) текущая таблица выбранной РК (самые точные для выбранного периода),
  // 2) кэш последних загруженных filterCounts по advertId (чтобы не мигали в 0 при переключении РК),
  // 3) summary из workspace по выбранной РК как мгновенный fallback до прихода таблицы.
  const isTableForCurrentCampaign =
    productAdvertisingClusterTable?.advertId === selectedCampaign?.advertId;
  const cachedFilterCountsForSelectedCampaign =
    selectedCampaign !== null
      ? clusterFilterCountsByAdvert.get(selectedCampaign.advertId) ?? null
      : null;
  const summaryFilterCountsForSelectedCampaign =
    selectedCampaign !== null
      ? {
          all: selectedCampaign.rowsCount,
          active: selectedCampaign.totals.activeCount,
          excluded: selectedCampaign.totals.excludedCount,
        }
      : null;
  const clusterFilterCounts =
    (isTableForCurrentCampaign ? productAdvertisingClusterTable?.filterCounts : null) ??
    cachedFilterCountsForSelectedCampaign ??
    summaryFilterCountsForSelectedCampaign ??
    { all: 0, active: 0, excluded: 0 };
  const isClusterTableLoading = isProductAdvertisingClusterTableLoading;
  // Ключ сброса выделения: меняется только при смене товара или кампании.
  // Поиск и фильтры НЕ должны сбрасывать галочки — пользователь выбирает кластеры,
  // сужает поиск, снимает нужные галочки, и после очистки поиска видит тот же набор.
  const selectionResetKey =
    nmId != null && selectedCampaign != null
      ? `${nmId}-${selectedCampaign.advertId}`
      : null;

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
    selectionResetKey,
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
  const visibleClusterTotals = useMemo(() => {
    const currency = selectedCampaign?.currency ?? null;
    return productAdvertisingClusterTable?.totals ?? getEmptyAdvertisingClusterTotals(currency);
  }, [productAdvertisingClusterTable, selectedCampaign?.currency]);
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

  const pagination = useMemo(
    () => ({
      page: productAdvertisingClusterTable?.pagination.page ?? 1,
      pageSize: productAdvertisingClusterTable?.pagination.pageSize ?? pageSize,
      totalRows: productAdvertisingClusterTable?.pagination.totalRows ?? 0,
      totalPages: productAdvertisingClusterTable?.pagination.totalPages ?? 1,
    }),
    [
      pageSize,
      productAdvertisingClusterTable?.pagination.page,
      productAdvertisingClusterTable?.pagination.pageSize,
      productAdvertisingClusterTable?.pagination.totalPages,
      productAdvertisingClusterTable?.pagination.totalRows,
    ],
  );

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
    clusterNameSearch,
    setClusterNameSearch,
    numericFilters,
    requestNumericFilters,
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
    handleClusterNameWidthChange,
  };
}

