import type {
  ProductAdvertisingSheetResponse,
  ProductAdvertisingWorkspaceClusterNumericFilters,
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingWorkspaceClusterSortDirection,
  ProductAdvertisingWorkspaceClusterSortKey,
  ProductAdvertisingWorkspaceClusterStatusFilter,
  ProductAdvertisingWorkspaceClusterTableResponse,
} from "./wb-clusters.types";
import {
  isWorkspaceClusterActive,
  isWorkspaceClusterExcluded,
  mergeWorkspaceClusters,
  projectWorkspaceClustersForRange,
} from "./product-workspace.builder";

import {
  buildClusterQuerySearchIndex,
  buildWorkspaceClusterKey,
  matchesClusterNumericFilters,
  matchesClusterSearch,
  matchesClusterStatusFilter,
} from "./product-workspace-cluster-table.filters";
import { compareWorkspaceClusterRows } from "./product-workspace-cluster-table.sort";
import { buildClusterTableTotals } from "./product-workspace-cluster-table.totals";

type WorkspaceClusterSourceRow = ProductAdvertisingSheetResponse["clusters"][number];

export function buildProductAdvertisingWorkspaceClusterTableResponse(input: {
  sheet: ProductAdvertisingSheetResponse;
  advertId: number;
  status: ProductAdvertisingWorkspaceClusterStatusFilter;
  search: string;
  numericFilters: ProductAdvertisingWorkspaceClusterNumericFilters;
  sortKey: ProductAdvertisingWorkspaceClusterSortKey;
  sortDirection: ProductAdvertisingWorkspaceClusterSortDirection;
  page: number;
  pageSize: number;
}): ProductAdvertisingWorkspaceClusterTableResponse {
  const mergedClusters = mergeWorkspaceClusters(input.sheet.clusters);
  const projectedClusters = projectWorkspaceClustersForRange(mergedClusters, input.sheet).map(
    (row: WorkspaceClusterSourceRow) => ({
      ...row,
      clusterKey: buildWorkspaceClusterKey(row.advertId, row.clusterName),
    }),
  );
  // Only include clusters explicitly managed in this campaign (active or excluded).
  // Stats-only clusters (sourceKind === "stats", isActive === null) are not part of
  // the campaign and must not inflate the count or appear as gray rows.
  const campaignRows = projectedClusters.filter(
    (row: ProductAdvertisingWorkspaceClusterRow) =>
      row.advertId === input.advertId &&
      (isWorkspaceClusterActive(row) || isWorkspaceClusterExcluded(row)),
  );
  const querySearchIndex = buildClusterQuerySearchIndex(input.sheet.clusterQueries, input.advertId);
  const searchValue = input.search.trim();
  const filteredRows = campaignRows
    .filter((row: ProductAdvertisingWorkspaceClusterRow) =>
      matchesClusterStatusFilter(row, input.status),
    )
    .filter((row: ProductAdvertisingWorkspaceClusterRow) =>
      matchesClusterSearch(row, searchValue, querySearchIndex),
    )
    .filter((row: ProductAdvertisingWorkspaceClusterRow) =>
      matchesClusterNumericFilters(row, input.numericFilters),
    )
    .sort((left: ProductAdvertisingWorkspaceClusterRow, right: ProductAdvertisingWorkspaceClusterRow) =>
      compareWorkspaceClusterRows(left, right, input.sortKey, input.sortDirection),
    );
  const pageSize = Math.max(1, input.pageSize);
  const page = Math.max(1, input.page);
  const totalRows = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pageRows = filteredRows.slice(startIndex, startIndex + pageSize);

  return {
    nmId: input.sheet.nmId,
    advertId: input.advertId,
    checkedAt: input.sheet.checkedAt,
    readiness: {
      scope: "cluster_table",
      status: "ready",
      source: "sheet_snapshot",
      materializationStatus: "fallback_sheet",
    },
    rows: pageRows,
    querySearchIndex: Object.fromEntries(querySearchIndex.entries()),
    totals: buildClusterTableTotals(filteredRows),
    totalsScope: "filtered_population",
    filterCounts: {
      all: campaignRows.length,
      active: campaignRows.filter((row: ProductAdvertisingWorkspaceClusterRow) => isWorkspaceClusterActive(row)).length,
      excluded: campaignRows.filter((row: ProductAdvertisingWorkspaceClusterRow) => isWorkspaceClusterExcluded(row)).length,
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

export { buildWorkspaceClusterKey } from "./product-workspace-cluster-table.filters";
