import type { DragEvent, ReactNode } from "react";

import type {
  ProductAdvertisingWorkspaceClusterQueriesResponse,
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingWorkspaceClusterTableTotals,
  ProductAdvertisingWorkspaceResponse,
} from "../../../api/syncClient";
import { ui } from "../copy";
import {
  type AdvertisingClusterNumericFilterKey,
  type AdvertisingClusterSortDirection,
  type AdvertisingClusterSortKey,
  type AdvertisingColumnDefinition,
  type AdvertisingColumnWidths,
} from "./clusterTableView";
import type { AdvertisingDateBounds, AdvertisingDatePreset, AdvertisingDateRange } from "./date";
import { ProductAdvertisingClusterDataTable } from "./ProductAdvertisingClusterDataTable";
import { ProductAdvertisingClusterOverview } from "./ProductAdvertisingClusterOverview";
import { ProductAdvertisingClusterTableSkeleton } from "./ProductAdvertisingClusterTableSkeleton";

type ClusterQueriesState = {
  loading: boolean;
  error: string | null;
  data: ProductAdvertisingWorkspaceClusterQueriesResponse | null;
};

type NumericFilters = Record<
  AdvertisingClusterNumericFilterKey,
  {
    min: string;
    max: string;
  }
>;

export type ProductAdvertisingClusterTableSectionProps = {
  nmId: number | null;
  campaignSummaries: ProductAdvertisingWorkspaceResponse["campaignTabs"];
  selectedCampaignAdvertId: number | null;
  onSelectCampaign: (advertId: number) => void;
  onCampaignHover?: (advertId: number) => void;
  statusFilter: "all" | "active" | "excluded";
  onStatusFilterChange: (value: "all" | "active" | "excluded") => void;
  clusterFilterCounts: {
    all: number;
    active: number;
    excluded: number;
  };
  canSubmitClusterAction: boolean;
  selectedExcludedClustersCount: number;
  selectedActiveClustersCount: number;
  isClusterActionSubmitting: boolean;
  hasSelectedPendingClusterActions: boolean;
  onApplyClusterAction: (action: "include" | "exclude") => void;
  isAdvertisingSyncStarting: boolean;
  onRunAdvertisingSync: () => void;
  onReloadAdvertising: () => void;
  dateRange: AdvertisingDateRange;
  clusterDailyStatsBounds: AdvertisingDateBounds;
  onDateRangeChange: (value: AdvertisingDateRange) => void;
  onPresetHover?: (preset: AdvertisingDatePreset) => void;
  diagnostics: ProductAdvertisingWorkspaceResponse["diagnostics"] | null;
  bidErrorMessage: string | null;
  clusterActionErrorMessage: string | null;
  clusterTableError: string | null;
  isWorkspaceLoading?: boolean;
  isClusterTableLoading: boolean;
  isClusterTableRefreshing: boolean;
  visibleClusterRows: ProductAdvertisingWorkspaceClusterRow[];
  orderedAdvertisingColumns: AdvertisingColumnDefinition[];
  advertisingColumnWidths: AdvertisingColumnWidths;
  sortState: {
    key: AdvertisingClusterSortKey;
    direction: AdvertisingClusterSortDirection;
  };
  draggedAdvertisingColumn: AdvertisingClusterSortKey | null;
  onSetDraggedAdvertisingColumn: (value: AdvertisingClusterSortKey | null) => void;
  onAdvertisingColumnDrop: (
    event: DragEvent<HTMLTableCellElement>,
    targetColumn: AdvertisingClusterSortKey,
  ) => void;
  onSortChange: (key: AdvertisingClusterSortKey) => void;
  allVisibleClustersSelected: boolean;
  onToggleSelectAllClusterGroups: () => void;
  clusterSearch: string;
  onClusterSearchChange: (value: string) => void;
  clusterNameSearch: string;
  onClusterNameSearchChange: (value: string) => void;
  numericFilters: NumericFilters;
  onNumericFilterChange: (
    key: AdvertisingClusterNumericFilterKey,
    bound: "min" | "max",
    nextValue: string,
  ) => void;
  onApplyNumericFilter: (key: AdvertisingClusterNumericFilterKey) => void;
  visibleClusterTotals: ProductAdvertisingWorkspaceClusterTableTotals;
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  onPageChange: (page: number) => void;
  expandedClusterKeys: string[];
  selectedClusterKeys: string[];
  onToggleSelectedClusterGroup: (
    groupKey: string,
    options?: { extendRange?: boolean },
  ) => void;
  onToggleClusterGroup: (groupKey: string) => void;
  productAdvertisingClusterQueriesByKey: Record<string, ClusterQueriesState>;
  renderClusterBidCell: (
    row: ProductAdvertisingWorkspaceClusterRow,
    options?: { nested?: boolean; emptyLabel?: string },
  ) => ReactNode;
  copiedClusterKey: string | null;
  onCopyClusterName: (clusterKey: string, clusterName: string) => void | Promise<void>;
  copiedQueryKey: string | null;
  onCopyQueryText: (queryKey: string, queryText: string) => void | Promise<void>;
  onClusterNameWidthChange: (width: number) => void;
};

export function ProductAdvertisingClusterTableSection(
  props: ProductAdvertisingClusterTableSectionProps,
) {
  const showSkeleton =
    props.selectedCampaignAdvertId !== null &&
    props.isClusterTableLoading &&
    props.visibleClusterRows.length === 0;

  // How many rows exist for the current status filter (server-side, before text search).
  const countForCurrentFilter =
    props.statusFilter === "active"
      ? props.clusterFilterCounts.active
      : props.statusFilter === "excluded"
        ? props.clusterFilterCounts.excluded
        : props.clusterFilterCounts.all;

  const hasActiveTextSearch =
    props.clusterSearch.trim().length > 0 || props.clusterNameSearch.trim().length > 0;
  const hasActiveNumericFilter = Object.values(props.numericFilters).some(
    (bounds) => bounds.min.trim().length > 0 || bounds.max.trim().length > 0,
  );
  const hasActiveSearch = hasActiveTextSearch || hasActiveNumericFilter;

  // Rows exist for this status filter but text/numeric search hid them all.
  // Only show this message when a search is actually active — not during loading or
  // transient states where cached counts still show non-zero but the table is reloading.
  const isSearchHidingAllRows =
    !props.isClusterTableLoading &&
    !props.isClusterTableRefreshing &&
    hasActiveSearch &&
    countForCurrentFilter > 0 &&
    props.visibleClusterRows.length === 0;

  // The status filter returns 0 rows, but the campaign does have clusters overall.
  // We still render the table skeleton (header + filter rows + totals) so "pinned"
  // structural rows remain visible — only the body gets an inline empty message.
  const isFilterHidingAllRows =
    countForCurrentFilter === 0 &&
    props.clusterFilterCounts.all > 0 &&
    props.visibleClusterRows.length === 0;

  const emptyBodyMessage = isSearchHidingAllRows
    ? ui.noClustersForSearch
    : isFilterHidingAllRows
      ? ui.noClustersForFilter
      : undefined;

  // Show the table structure whenever a campaign is selected and data has been
  // loaded (even when it returns 0 rows). The empty message is shown inside the
  // table body so the header, filter inputs, and totals row stay visible.
  const shouldShowTable =
    props.selectedCampaignAdvertId !== null &&
    !showSkeleton &&
    (props.visibleClusterRows.length > 0 ||
      isSearchHidingAllRows ||
      isFilterHidingAllRows ||
      (!props.isClusterTableLoading && !props.isClusterTableRefreshing));

  return (
    <>
      <ProductAdvertisingClusterOverview {...props} />
      {props.selectedCampaignAdvertId !== null ? (
        showSkeleton ? (
          <ProductAdvertisingClusterTableSkeleton />
        ) : shouldShowTable ? (
          <div
            className="wb-advertising-cluster-table-wrap"
            style={props.isClusterTableRefreshing ? { opacity: 0.45, transition: "opacity 0.15s" } : { transition: "opacity 0.15s" }}
          >
            <ProductAdvertisingClusterDataTable
              {...props}
              emptySearchMessage={emptyBodyMessage}
            />
          </div>
        ) : null
      ) : !props.isWorkspaceLoading && props.campaignSummaries.length === 0 ? (
        <p className="wb-empty-copy">{ui.noCampaignsForPeriod}</p>
      ) : null}
    </>
  );
}
