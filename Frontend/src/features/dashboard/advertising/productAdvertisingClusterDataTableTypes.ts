import type { ProductAdvertisingClusterQuery, ProductAdvertisingWorkspaceClusterRow } from "../../../api/syncClient";
import type { ProductAdvertisingClusterTableSectionProps } from "./ProductAdvertisingClusterTableSection";

export type ProductAdvertisingClusterDataTableProps = Pick<
  ProductAdvertisingClusterTableSectionProps,
  | "nmId"
  | "selectedCampaignAdvertId"
  | "visibleClusterRows"
  | "orderedAdvertisingColumns"
  | "advertisingColumnWidths"
  | "sortState"
  | "draggedAdvertisingColumn"
  | "onSetDraggedAdvertisingColumn"
  | "onAdvertisingColumnDrop"
  | "onSortChange"
  | "allVisibleClustersSelected"
  | "onToggleSelectAllClusterGroups"
  | "clusterSearch"
  | "onClusterSearchChange"
  | "clusterNameSearch"
  | "onClusterNameSearchChange"
  | "numericFilters"
  | "onNumericFilterChange"
  | "onApplyNumericFilter"
  | "visibleClusterTotals"
  | "expandedClusterKeys"
  | "selectedClusterKeys"
  | "onToggleSelectedClusterGroup"
  | "onToggleClusterGroup"
  | "productAdvertisingClusterQueriesByKey"
  | "renderClusterBidCell"
  | "copiedClusterKey"
  | "onCopyClusterName"
  | "copiedQueryKey"
  | "onCopyQueryText"
  | "onClusterNameWidthChange"
> & {
  emptySearchMessage?: string;
};

export type ProductAdvertisingClusterCellRendererInput = {
  row: ProductAdvertisingWorkspaceClusterRow;
  queries: ProductAdvertisingClusterQuery[];
};
