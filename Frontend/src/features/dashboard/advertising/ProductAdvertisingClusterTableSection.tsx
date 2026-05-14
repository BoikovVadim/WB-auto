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
  onToggleSelectedClusterGroup: (groupKey: string) => void;
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

function ClusterTableSkeleton() {
  return (
    <div className="wb-cluster-skeleton-wrap">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="wb-cluster-skeleton-row">
          <div className="wb-cluster-skeleton-cell wb-cluster-skeleton-cell--wide" />
          <div className="wb-cluster-skeleton-cell" />
          <div className="wb-cluster-skeleton-cell" />
          <div className="wb-cluster-skeleton-cell" />
          <div className="wb-cluster-skeleton-cell" />
          <div className="wb-cluster-skeleton-cell" />
        </div>
      ))}
    </div>
  );
}

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

  // Rows exist for this status filter but text search hid them all.
  const isSearchHidingAllRows =
    countForCurrentFilter > 0 && props.visibleClusterRows.length === 0;

  return (
    <>
      <ProductAdvertisingClusterOverview {...props} />
      {props.selectedCampaignAdvertId !== null ? (
        props.visibleClusterRows.length > 0 || isSearchHidingAllRows ? (
          <div
            className="wb-advertising-cluster-table-wrap"
            style={props.isClusterTableRefreshing ? { opacity: 0.45, pointerEvents: "none", transition: "opacity 0.15s" } : { transition: "opacity 0.15s" }}
          >
            {isSearchHidingAllRows ? (
              <p className="wb-empty-copy" style={{ paddingTop: 24 }}>
                {ui.noClustersForSearch}
              </p>
            ) : (
              <ProductAdvertisingClusterDataTable {...props} />
            )}
          </div>
        ) : showSkeleton ? (
          <ClusterTableSkeleton />
        ) : !props.isClusterTableLoading && !props.isClusterTableRefreshing ? (
          <p className="wb-empty-copy">
            {props.statusFilter !== "all" ? ui.noClustersForFilter : ui.noClustersForCampaign}
          </p>
        ) : null
      ) : null}
    </>
  );
}
