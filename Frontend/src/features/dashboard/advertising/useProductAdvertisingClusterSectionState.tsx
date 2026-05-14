import { useCallback, useMemo } from "react";

import { fetchProductAdvertisingWorkspaceClusterTable } from "../../../api/syncClientAdvertisingRead";
import type { ProductAdvertisingWorkspaceResponse } from "../../../api/syncClient";
import type { ProductAdvertisingClusterTableSectionProps } from "./ProductAdvertisingClusterTableSection";
import { getAdvertisingDatePresetRange, formatCalendarDateValue, type AdvertisingDatePreset, type AdvertisingDateRange } from "./date";
import type { ProductAdvertisingDetailRevisions } from "./productAdvertisingDetailInvalidation";
import { useProductAdvertisingClusterMutations } from "./useProductAdvertisingClusterMutations";
import { useProductAdvertisingClusterTableState } from "./useProductAdvertisingClusterTableState";

export function useProductAdvertisingClusterSectionState(input: {
  nmId: number | null;
  detailRevisions: ProductAdvertisingDetailRevisions;
  workspace: ProductAdvertisingWorkspaceResponse | null;
  dateRange: AdvertisingDateRange;
  onDateRangeChange: (value: AdvertisingDateRange) => void;
  isAdvertisingSyncStarting: boolean;
  onRunAdvertisingSync: () => void;
  onReloadSheet: (options?: {
    advertId?: number | null;
    target?: "workspace" | "table" | "queries" | "detail" | "all";
    invalidateCaches?: boolean;
  }) => Promise<void>;
}) {
  const {
    nmId,
    detailRevisions,
    workspace,
    dateRange,
    onDateRangeChange,
    isAdvertisingSyncStarting,
    onRunAdvertisingSync,
    onReloadSheet,
  } = input;

  const tableState = useProductAdvertisingClusterTableState({
    nmId,
    detailRevisions,
    workspace,
    dateRange,
  });
  const mutations = useProductAdvertisingClusterMutations({
    nmId,
    selectedCampaignAdvertId: tableState.selectedCampaignAdvertId,
    selectedClusterRows: tableState.selectedClusterRows,
    hasSelectedPendingClusterActions: tableState.hasSelectedPendingClusterActions,
    clusterRowByKey: tableState.clusterRowByKey,
    requestInput: tableState.clusterTableRequestInput,
    onClearSelectedClusterKeys: tableState.clearSelectedClusterKeys,
    onReloadSheet,
  });

  // Prefetch-коллбэк для hover на пресете: начинает загружать таблицу кластеров
  // за будущий диапазон ДО клика. К моменту выбора данные уже в кеше/in-flight.
  // Делаем для всех кампаний товара — пользователь может переключиться на любую.
  const onPresetHover = useCallback(
    (preset: AdvertisingDatePreset) => {
      if (!nmId || !tableState.campaignSummaries.length) return;
      const range = getAdvertisingDatePresetRange(preset);
      if (!range.start || !range.end) return;
      const requestInput = {
        startDate: formatCalendarDateValue(range.start),
        endDate: formatCalendarDateValue(range.end),
      };
      for (const campaign of tableState.campaignSummaries) {
        void fetchProductAdvertisingWorkspaceClusterTable({
          nmId,
          advertId: campaign.advertId,
          requestInput,
          // Must match the real table request (backend sort is fixed; UI sort is client-side).
          sortKey: "spend",
          sortDirection: "desc",
          pageSize: 5000,
        }).catch(() => null);
      }
    },
    [nmId, tableState.campaignSummaries],
  );

  // Prefetch-коллбэк для hover на карточке кампании: загружает таблицу кластеров
  // за ТЕКУЩИЙ выбранный диапазон дат ДО клика. Устраняет задержку при переключении
  // между РК — к моменту клика данные уже в кеше или почти загружены.
  const onCampaignHover = useCallback(
    (advertId: number) => {
      if (!nmId || !tableState.clusterTableRequestInput) return;
      void fetchProductAdvertisingWorkspaceClusterTable({
        nmId,
        advertId,
        requestInput: tableState.clusterTableRequestInput,
        // Must match the real table request (backend sort is fixed; UI sort is client-side).
        sortKey: "spend",
        sortDirection: "desc",
        pageSize: 5000,
      }).catch(() => null);
    },
    [nmId, tableState.clusterTableRequestInput],
  );

  const onApplyClusterAction = useCallback(
    (action: Parameters<ProductAdvertisingClusterTableSectionProps["onApplyClusterAction"]>[0]) => {
      void mutations.handleApplyClusterAction(action);
    },
    [mutations.handleApplyClusterAction],
  );

  const onReloadAdvertising = useCallback(() => {
    void onReloadSheet({ target: "all" });
  }, [onReloadSheet]);

  const sectionProps: ProductAdvertisingClusterTableSectionProps = useMemo(() => ({
    nmId,
    campaignSummaries: tableState.campaignSummaries,
    selectedCampaignAdvertId: tableState.selectedCampaignAdvertId,
    onSelectCampaign: tableState.onSelectCampaign,
    onCampaignHover,
    statusFilter: tableState.statusFilter,
    onStatusFilterChange: tableState.setStatusFilter,
    clusterFilterCounts: tableState.clusterFilterCounts,
    canSubmitClusterAction: tableState.canSubmitClusterAction,
    selectedExcludedClustersCount: tableState.selectedExcludedClustersCount,
    selectedActiveClustersCount: tableState.selectedActiveClustersCount,
    isClusterActionSubmitting: mutations.isClusterActionSubmitting,
    hasSelectedPendingClusterActions: tableState.hasSelectedPendingClusterActions,
    onApplyClusterAction,
    dateRange,
    clusterDailyStatsBounds: tableState.clusterDailyStatsBounds,
    onDateRangeChange,
    onPresetHover,
    isAdvertisingSyncStarting,
    onRunAdvertisingSync,
    onReloadAdvertising,
    diagnostics: workspace?.diagnostics ?? null,
    bidErrorMessage: mutations.bidErrorMessage,
    clusterActionErrorMessage: mutations.clusterActionErrorMessage,
    clusterTableError: tableState.clusterTableError,
    isClusterTableLoading: tableState.isClusterTableLoading,
    isClusterTableRefreshing: tableState.isClusterTableRefreshing,
    visibleClusterRows: tableState.visibleClusterRows,
    orderedAdvertisingColumns: tableState.orderedAdvertisingColumns,
    advertisingColumnWidths: tableState.advertisingColumnWidths,
    sortState: tableState.sortState,
    draggedAdvertisingColumn: tableState.draggedAdvertisingColumn,
    onSetDraggedAdvertisingColumn: tableState.setDraggedAdvertisingColumn,
    onAdvertisingColumnDrop: tableState.handleAdvertisingColumnDrop,
    onSortChange: tableState.handleSortChange,
    allVisibleClustersSelected: tableState.allVisibleClustersSelected,
    onToggleSelectAllClusterGroups: tableState.toggleSelectAllClusterGroups,
    clusterSearch: tableState.clusterSearch,
    onClusterSearchChange: tableState.setClusterSearch,
    numericFilters: tableState.numericFilters,
    onNumericFilterChange: tableState.handleNumericFilterChange,
    onApplyNumericFilter: tableState.applyNumericFilter,
    visibleClusterTotals: tableState.visibleClusterTotals,
    pagination: tableState.pagination,
    onPageChange: tableState.onPageChange,
    expandedClusterKeys: tableState.expandedClusterKeys,
    selectedClusterKeys: tableState.selectedClusterKeys,
    onToggleSelectedClusterGroup: tableState.toggleSelectedClusterGroup,
    onToggleClusterGroup: tableState.toggleClusterGroup,
    productAdvertisingClusterQueriesByKey: tableState.productAdvertisingClusterQueriesByKey,
    renderClusterBidCell: mutations.renderClusterBidCell,
    copiedClusterKey: mutations.copiedClusterKey,
    onCopyClusterName: mutations.onCopyClusterName,
    copiedQueryKey: mutations.copiedQueryKey,
    onCopyQueryText: mutations.onCopyQueryText,
    onClusterNameWidthChange: tableState.handleClusterNameWidthChange,
  }), [
    nmId, tableState, mutations, onCampaignHover, onApplyClusterAction,
    dateRange, onDateRangeChange, onPresetHover, isAdvertisingSyncStarting,
    onRunAdvertisingSync, onReloadAdvertising, workspace?.diagnostics,
  ]);

  return {
    sectionProps,
  };
}
