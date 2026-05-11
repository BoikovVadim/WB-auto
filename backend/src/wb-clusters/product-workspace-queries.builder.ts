import type { ProductAdvertisingWorkspaceClusterQueriesSnapshot } from "./product-workspace-snapshot.types";
import {
  buildProductAdvertisingWorkspaceClusterQueriesResponse,
} from "./product-workspace-cluster-queries.builder";
import type {
  ProductAdvertisingWorkspaceClusterQueriesResponse,
  ProductAdvertisingWorkspaceClusterSortDirection,
  ProductAdvertisingWorkspaceClusterSortKey,
} from "./wb-clusters.types";

export function buildProductAdvertisingWorkspaceQueriesResponse(input: {
  nmId: number;
  advertId: number;
  clusterKey: string;
  clusterName: string;
  snapshot: ProductAdvertisingWorkspaceClusterQueriesSnapshot;
  sortKey: ProductAdvertisingWorkspaceClusterSortKey;
  sortDirection: ProductAdvertisingWorkspaceClusterSortDirection;
}): ProductAdvertisingWorkspaceClusterQueriesResponse {
  return buildProductAdvertisingWorkspaceClusterQueriesResponse({
    sheet: {
      nmId: input.nmId,
      checkedAt: input.snapshot.checkedAt,
      snapshot: {
        status: "ready",
        fit: "exact",
        source: "exact_snapshot",
        builtAt: input.snapshot.checkedAt,
        requestedStartDate: null,
        requestedEndDate: null,
        snapshotStartDate: null,
        snapshotEndDate: null,
        builtFromExportRequestId: null,
        lastError: null,
      },
      range: {
        startDate: null,
        endDate: null,
        jamIncluded: true,
        jamStatus: "ready",
      },
      summary: {
        campaignsCount: 0,
        clustersCount: 0,
        clusterQueriesCount: input.snapshot.queries.length,
        dailyStatsCount: 0,
        minusPhrasesCount: 0,
        keywordStatsCount: 0,
        queryCoverageStatus: "no-clusters",
        queryCoverageReason: null,
        dailyStatsCoverageStatus: "not_requested",
        dailyStatsCoverageReason: null,
        dailyStatsWindowStartDate: null,
        dailyStatsWindowEndDate: null,
        periodMetricsStatus: "unavailable",
        periodMetricsReason: null,
        periodMetricsActualStartDate: null,
        periodMetricsActualEndDate: null,
      },
      campaigns: [],
      clusters: [],
      clusterQueries: input.snapshot.queries,
      dailyStats: [],
      minusPhrases: [],
      keywordStats: [],
    },
    advertId: input.advertId,
    clusterKey: input.clusterKey,
    clusterName: input.clusterName,
    sortKey: input.sortKey,
    sortDirection: input.sortDirection,
  });
}
