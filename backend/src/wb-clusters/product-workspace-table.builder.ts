import {
  matchesClusterNumericFilters,
  matchesClusterSearch,
  matchesClusterStatusFilter,
} from "./product-workspace-cluster-table.filters";
import { compareWorkspaceClusterRows } from "./product-workspace-cluster-table.sort";
import { buildClusterTableTotals } from "./product-workspace-cluster-table.totals";
import {
  isWorkspaceClusterActive,
  isWorkspaceClusterExcluded,
} from "./product-workspace.builder.sources";
import type { ProductAdvertisingWorkspaceCampaignRowsSnapshot } from "./product-workspace-snapshot.types";
import type {
  ProductAdvertisingWorkspaceClusterNumericFilters,
  ProductAdvertisingWorkspaceClusterSortDirection,
  ProductAdvertisingWorkspaceClusterSortKey,
  ProductAdvertisingWorkspaceClusterStatusFilter,
  ProductAdvertisingWorkspaceClusterTableResponse,
} from "./wb-clusters.types";

export function buildProductAdvertisingWorkspaceTableResponse(input: {
  nmId: number;
  advertId: number;
  snapshot: ProductAdvertisingWorkspaceCampaignRowsSnapshot;
  status: ProductAdvertisingWorkspaceClusterStatusFilter;
  search: string;
  numericFilters: ProductAdvertisingWorkspaceClusterNumericFilters;
  sortKey: ProductAdvertisingWorkspaceClusterSortKey;
  sortDirection: ProductAdvertisingWorkspaceClusterSortDirection;
  page: number;
  pageSize: number;
}): ProductAdvertisingWorkspaceClusterTableResponse {
  const searchValue = input.search.trim();
  const querySearchIndex = new Map(Object.entries(input.snapshot.querySearchIndex));
  // Exclude stats-only clusters that are not explicitly managed (active or excluded).
  // Old snapshots may contain gray clusters; this filter removes them at read time.
  const managedRows = input.snapshot.rows.filter(
    (row) => isWorkspaceClusterActive(row) || isWorkspaceClusterExcluded(row),
  );
  const filteredRows = managedRows
    .filter((row) => matchesClusterStatusFilter(row, input.status))
    .filter((row) => matchesClusterSearch(row, searchValue, querySearchIndex))
    .filter((row) => matchesClusterNumericFilters(row, input.numericFilters))
    .sort((left, right) =>
      compareWorkspaceClusterRows(left, right, input.sortKey, input.sortDirection),
    );
  const pageSize = Math.max(1, input.pageSize);
  const page = Math.max(1, input.page);
  const totalRows = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;

  return {
    nmId: input.nmId,
    advertId: input.advertId,
    checkedAt: input.snapshot.checkedAt,
    readiness: {
      scope: "cluster_table",
      status: "ready",
      source: "workspace_snapshot",
      materializationStatus: "materialized",
    },
    rows: filteredRows.slice(startIndex, startIndex + pageSize),
    querySearchIndex: input.snapshot.querySearchIndex,
    totals: buildClusterTableTotals(filteredRows),
    totalsScope: "filtered_population",
    filterCounts: {
      all: managedRows.length,
      active: managedRows.filter((row) => isWorkspaceClusterActive(row)).length,
      excluded: managedRows.filter((row) => isWorkspaceClusterExcluded(row)).length,
    },
    appliedFilters: {
      search: searchValue,
      status: input.status,
      numericFilters: input.numericFilters,
    },
    sort: {
      key: input.sortKey,
      direction: input.sortDirection,
    },
    pagination: {
      page: safePage,
      pageSize,
      totalRows,
      totalPages,
    },
  };
}
