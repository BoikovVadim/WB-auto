import { useCallback, useMemo } from "react";

import { fetchProductAdvertisingWorkspaceClusterTable } from "../../../api/syncClientAdvertisingRead";
import type { ProductAdvertisingWorkspaceResponse } from "../../../api/syncClient";
import type { ProductAdvertisingClusterTableSectionProps } from "./ProductAdvertisingClusterTableSection";
import { toProductAdvertisingWorkspaceNumericFilters } from "./advertisingModelFilters";
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
  const requestNumericFilters = useMemo(
    () => toProductAdvertisingWorkspaceNumericFilters(tableState.numericFilters),
    [tableState.numericFilters],
  );

  // Hover по пресету прогревает ровно тот backend-shaped slice, который пользователь
  // увидит после клика: те же фильтры/сортировки, но с будущим диапазоном.
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
          search: tableState.clusterSearch,
          clusterNameSearch: tableState.clusterNameSearch,
          status: tableState.statusFilter,
          numericFilters: requestNumericFilters,
          sortKey: tableState.sortState.key,
          sortDirection: tableState.sortState.direction,
          pageSize: 5000,
        }).catch(() => null);
      }
    },
    [nmId, requestNumericFilters, tableState],
  );

  // Hover по карточке кампании греет exact slice для текущего backend query state.
  const onCampaignHover = useCallback(
    (advertId: number) => {
      if (!nmId || !tableState.clusterTableRequestInput) return;
      void fetchProductAdvertisingWorkspaceClusterTable({
        nmId,
        advertId,
        requestInput: tableState.clusterTableRequestInput,
        search: tableState.clusterSearch,
        clusterNameSearch: tableState.clusterNameSearch,
        status: tableState.statusFilter,
        numericFilters: requestNumericFilters,
        sortKey: tableState.sortState.key,
        sortDirection: tableState.sortState.direction,
        pageSize: 5000,
      }).catch(() => null);
    },
    [nmId, requestNumericFilters, tableState],
  );

  const onApplyClusterAction = useCallback(
    (action: Parameters<ProductAdvertisingClusterTableSectionProps["onApplyClusterAction"]>[0]) => {
      void mutations.handleApplyClusterAction(action);
    },
    [mutations],
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
    clusterNameSearch: tableState.clusterNameSearch,
    onClusterNameSearchChange: tableState.setClusterNameSearch,
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
