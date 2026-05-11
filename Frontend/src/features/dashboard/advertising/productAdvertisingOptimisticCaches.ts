import {
  cacheProductWorkspace,
  getCachedProductWorkspace,
} from "../../../api/productWorkspaceClient";
import {
  cacheProductWorkspaceClusterQueries,
  cacheProductWorkspaceClusterTable,
  getCachedProductWorkspaceClusterQueriesEntriesMatching,
  getCachedProductWorkspaceClusterTableEntriesMatching,
} from "../../../api/productWorkspaceSlicesCache";
import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import type {
  ProductAdvertisingClusterActionResponse,
  ProductAdvertisingClusterBidUpdateResponse,
  ProductAdvertisingWorkspaceClusterQueriesResponse,
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingWorkspaceClusterTableResponse,
  ProductAdvertisingWorkspaceResponse,
} from "../../../api/syncClient";
import {
  getAdvertisingCostPerThousand,
  getAdvertisingMoneyPerAction,
  getAdvertisingOrderedItems,
  getAdvertisingRatio,
  isClusterActive,
  isClusterExcluded,
} from "./model";
import { buildWorkspaceShellClusterKey } from "./productWorkspaceShell";

type CachedTableEntry = [string, ProductAdvertisingWorkspaceClusterTableResponse];
type CachedQueryEntry = [string, ProductAdvertisingWorkspaceClusterQueriesResponse];

type ProductAdvertisingDetailCacheSnapshot = {
  workspace: ProductAdvertisingWorkspaceResponse | null;
  tableEntries: CachedTableEntry[];
  queryEntries: CachedQueryEntry[];
};

type OptimisticClusterActionPatch = {
  nmId: number;
  advertId: number;
  requestInput: ProductAdvertisingSheetRequestInput;
  selectedClusterRows: ProductAdvertisingWorkspaceClusterRow[];
  action: "include" | "exclude";
};

type OptimisticClusterBidPatch = {
  nmId: number;
  advertId: number;
  requestInput: ProductAdvertisingSheetRequestInput;
  row: ProductAdvertisingWorkspaceClusterRow;
  bid: number;
};

type ClusterActionLike = {
  clusterName: string;
  desiredIsActive: boolean;
  status: ProductAdvertisingWorkspaceClusterRow["actionSyncStatus"];
  retryAt: string | null;
  lastError: string | null;
};

type ClusterBidLike = {
  clusterName: string;
  bid: number;
  status: ProductAdvertisingWorkspaceClusterRow["bidSyncStatus"];
  retryAt: string | null;
  lastError: string | null;
};

export function captureProductAdvertisingDetailCacheSnapshot(input: {
  nmId: number;
  advertId: number;
  requestInput: ProductAdvertisingSheetRequestInput;
}): ProductAdvertisingDetailCacheSnapshot {
  return {
    workspace: getCachedProductWorkspace(input.nmId, input.requestInput),
    tableEntries: getCachedProductWorkspaceClusterTableEntriesMatching(input).map(([key, value]) => [
      key,
      structuredClone(value),
    ]),
    queryEntries: getCachedProductWorkspaceClusterQueriesEntriesMatching(input).map(([key, value]) => [
      key,
      structuredClone(value),
    ]),
  };
}

export function restoreProductAdvertisingDetailCacheSnapshot(input: {
  nmId: number;
  requestInput: ProductAdvertisingSheetRequestInput;
  snapshot: ProductAdvertisingDetailCacheSnapshot;
}) {
  if (input.snapshot.workspace) {
    cacheProductWorkspace(input.nmId, input.requestInput, input.snapshot.workspace);
  }

  for (const [key, value] of input.snapshot.tableEntries) {
    cacheProductWorkspaceClusterTable(key, value);
  }

  for (const [key, value] of input.snapshot.queryEntries) {
    cacheProductWorkspaceClusterQueries(key, value);
  }
}

export function applyOptimisticClusterActionPatch(input: OptimisticClusterActionPatch) {
  const queuedStatus: ClusterActionLike["status"] = "queued";
  const desiredIsActive = input.action === "include";
  const actionUpdates = new Map(
    input.selectedClusterRows.map((row) => [
      row.clusterKey,
      {
        clusterName: row.clusterName,
        desiredIsActive,
        status: queuedStatus,
        retryAt: null,
        lastError: null,
      } satisfies ClusterActionLike,
    ]),
  );

  patchWorkspaceCacheForOptimisticAction(input, actionUpdates);
  patchTableCachesForAction(input, actionUpdates);
  patchQueryCachesForAction(input, actionUpdates);
}

export function applyClusterActionResponsePatch(input: {
  nmId: number;
  requestInput: ProductAdvertisingSheetRequestInput;
  response: ProductAdvertisingClusterActionResponse;
}) {
  const actionUpdates = new Map(
    input.response.actions.map((action) => [
      buildClusterKey(input.response.advertId, action.clusterName),
      {
        clusterName: action.clusterName,
        desiredIsActive: action.desiredIsActive,
        status: action.status,
        retryAt: action.retryAt,
        lastError: action.lastError,
      } satisfies ClusterActionLike,
    ]),
  );

  const patchInput = {
    nmId: input.nmId,
    advertId: input.response.advertId,
    requestInput: input.requestInput,
  };
  patchWorkspacePendingState(patchInput);
  patchTableCachesForAction(patchInput, actionUpdates);
  patchQueryCachesForAction(patchInput, actionUpdates);
}

export function applyOptimisticClusterBidPatch(input: OptimisticClusterBidPatch) {
  const bidUpdates = new Map<string, ClusterBidLike>([
    [
      input.row.clusterKey,
      {
        clusterName: input.row.clusterName,
        bid: input.bid,
        status: "queued",
        retryAt: null,
        lastError: null,
      },
    ],
  ]);

  patchWorkspacePendingState(input);
  patchTableCachesForBid(input, bidUpdates);
}

export function applyClusterBidResponsePatch(input: {
  nmId: number;
  requestInput: ProductAdvertisingSheetRequestInput;
  response: ProductAdvertisingClusterBidUpdateResponse;
}) {
  const bidUpdates = new Map(
    input.response.bids.map((bid) => [
      buildClusterKey(input.response.advertId, bid.clusterName),
      {
        clusterName: bid.clusterName,
        bid: bid.bid,
        status: bid.status,
        retryAt: bid.retryAt,
        lastError: bid.lastError,
      } satisfies ClusterBidLike,
    ]),
  );

  const patchInput = {
    nmId: input.nmId,
    advertId: input.response.advertId,
    requestInput: input.requestInput,
  };
  patchWorkspacePendingState(patchInput);
  patchTableCachesForBid(patchInput, bidUpdates);
}

function patchWorkspacePendingState(input: {
  nmId: number;
  requestInput: ProductAdvertisingSheetRequestInput;
}) {
  const cachedWorkspace = getCachedProductWorkspace(input.nmId, input.requestInput);
  if (!cachedWorkspace) {
    return;
  }

  cacheProductWorkspace(input.nmId, input.requestInput, {
    ...cachedWorkspace,
    syncState: {
      ...cachedWorkspace.syncState,
      hasPendingClusterSync: true,
    },
  });
}

function patchWorkspaceCacheForOptimisticAction(
  input: OptimisticClusterActionPatch,
  actionUpdates: Map<string, ClusterActionLike>,
) {
  const cachedWorkspace = getCachedProductWorkspace(input.nmId, input.requestInput);
  if (!cachedWorkspace) {
    return;
  }

  let activeDelta = 0;
  let excludedDelta = 0;

  for (const row of input.selectedClusterRows) {
    const update = actionUpdates.get(row.clusterKey);
    if (!update) {
      continue;
    }

    const prevActive = isClusterActive(row);
    const nextActive = update.desiredIsActive;
    const prevExcluded = isClusterExcluded(row);
    const nextExcluded = !update.desiredIsActive;

    activeDelta += Number(nextActive) - Number(prevActive);
    excludedDelta += Number(nextExcluded) - Number(prevExcluded);
  }

  if (activeDelta === 0 && excludedDelta === 0) {
    cacheProductWorkspace(input.nmId, input.requestInput, {
      ...cachedWorkspace,
      syncState: {
        ...cachedWorkspace.syncState,
        hasPendingClusterSync: true,
      },
    });
    return;
  }

  const patchCampaignTab = (campaign: ProductAdvertisingWorkspaceResponse["campaignTabs"][number]) =>
    campaign.advertId !== input.advertId
      ? campaign
      : {
          ...campaign,
          totals: {
            ...campaign.totals,
            activeCount: Math.max(0, campaign.totals.activeCount + activeDelta),
            excludedCount: Math.max(0, campaign.totals.excludedCount + excludedDelta),
          },
        };

  const nextCampaignTabs = cachedWorkspace.campaignTabs.map(patchCampaignTab);
  const nextSelectedCampaignSummary = cachedWorkspace.selectedCampaignSummary
    ? patchCampaignTab(cachedWorkspace.selectedCampaignSummary)
    : null;

  cacheProductWorkspace(input.nmId, input.requestInput, {
    ...cachedWorkspace,
    checkedAt: new Date().toISOString(),
    campaignTabs: nextCampaignTabs,
    selectedCampaignSummary: nextSelectedCampaignSummary,
    syncState: {
      ...cachedWorkspace.syncState,
      hasPendingClusterSync: true,
    },
  });
}

function patchTableCachesForAction(
  input: {
    nmId: number;
    advertId: number;
    requestInput: ProductAdvertisingSheetRequestInput;
  },
  actionUpdates: Map<string, ClusterActionLike>,
) {
  for (const [key, table] of getCachedProductWorkspaceClusterTableEntriesMatching(input)) {
    let activeDelta = 0;
    let excludedDelta = 0;
    let filteredDelta = 0;
    const removedRows: ProductAdvertisingWorkspaceClusterRow[] = [];
    const nextRows: ProductAdvertisingWorkspaceClusterRow[] = [];

    for (const row of table.rows) {
      const update = actionUpdates.get(row.clusterKey);
      if (!update) {
        nextRows.push(row);
        continue;
      }

      const nextRow: ProductAdvertisingWorkspaceClusterRow = {
        ...row,
        isActive: update.desiredIsActive,
        sourceKind: update.desiredIsActive ? "active" : "excluded",
        actionSyncStatus: update.status,
        actionRetryAt: update.retryAt,
        actionLastError: update.lastError,
      };

      const prevActive = isClusterActive(row);
      const nextActive = isClusterActive(nextRow);
      const prevExcluded = isClusterExcluded(row);
      const nextExcluded = isClusterExcluded(nextRow);
      const prevMatches = matchesTableStatus(row, table.appliedFilters.status);
      const nextMatches = matchesTableStatus(nextRow, table.appliedFilters.status);

      activeDelta += Number(nextActive) - Number(prevActive);
      excludedDelta += Number(nextExcluded) - Number(prevExcluded);
      filteredDelta += Number(nextMatches) - Number(prevMatches);

      if (prevMatches && !nextMatches) {
        removedRows.push(nextRow);
      }

      if (nextMatches) {
        nextRows.push(nextRow);
      }
    }

    const nextTotalRows = Math.max(0, table.pagination.totalRows + filteredDelta);
    const nextTotalPages = Math.max(1, Math.ceil(nextTotalRows / table.pagination.pageSize));
    const nextPage = Math.min(table.pagination.page, nextTotalPages);

    const nextTable: ProductAdvertisingWorkspaceClusterTableResponse = {
      ...table,
      checkedAt: new Date().toISOString(),
      rows: nextRows,
      filterCounts: {
        ...table.filterCounts,
        active: Math.max(0, table.filterCounts.active + activeDelta),
        excluded: Math.max(0, table.filterCounts.excluded + excludedDelta),
      },
      totals:
        table.appliedFilters.status === "all" || removedRows.length === 0
          ? table.totals
          : subtractRowsFromTotals(table.totals, removedRows),
      pagination: {
        ...table.pagination,
        page: nextPage,
        totalRows: nextTotalRows,
        totalPages: nextTotalPages,
      },
    };

    cacheProductWorkspaceClusterTable(key, nextTable);
  }
}

function patchTableCachesForBid(
  input: {
    nmId: number;
    advertId: number;
    requestInput: ProductAdvertisingSheetRequestInput;
  },
  bidUpdates: Map<string, ClusterBidLike>,
) {
  for (const [key, table] of getCachedProductWorkspaceClusterTableEntriesMatching(input)) {
    let changed = false;
    const nextRows = table.rows.map((row) => {
      const update = bidUpdates.get(row.clusterKey);
      if (!update) {
        return row;
      }

      changed = true;
      return {
        ...row,
        bid: update.bid,
        bidSyncStatus: update.status,
        bidRetryAt: update.retryAt,
        bidLastError: update.lastError,
        bidConfirmedAt: update.status === "confirmed" ? new Date().toISOString() : row.bidConfirmedAt,
      };
    });

    if (!changed) {
      continue;
    }

    cacheProductWorkspaceClusterTable(key, {
      ...table,
      checkedAt: new Date().toISOString(),
      rows: nextRows,
    });
  }
}

function patchQueryCachesForAction(
  input: {
    nmId: number;
    advertId: number;
    requestInput: ProductAdvertisingSheetRequestInput;
  },
  actionUpdates: Map<string, ClusterActionLike>,
) {
  for (const [key, queries] of getCachedProductWorkspaceClusterQueriesEntriesMatching(input)) {
    const update = actionUpdates.get(queries.clusterKey);
    if (!update) {
      continue;
    }

    cacheProductWorkspaceClusterQueries(key, {
      ...queries,
      checkedAt: new Date().toISOString(),
      queries: queries.queries.map((query) => ({
        ...query,
        isActive: update.desiredIsActive,
        sourceKind: update.desiredIsActive ? "active" : "excluded",
      })),
    });
  }
}

function matchesTableStatus(
  row: ProductAdvertisingWorkspaceClusterRow,
  status: ProductAdvertisingWorkspaceClusterTableResponse["appliedFilters"]["status"],
) {
  if (status === "active") {
    return isClusterActive(row);
  }

  if (status === "excluded") {
    return isClusterExcluded(row);
  }

  return true;
}

function subtractRowsFromTotals(
  totals: ProductAdvertisingWorkspaceClusterTableResponse["totals"],
  rows: ProductAdvertisingWorkspaceClusterRow[],
): ProductAdvertisingWorkspaceClusterTableResponse["totals"] {
  const views = subtractNullableNumber(totals.views, sumNullableNumbers(rows.map((row) => row.views)));
  const clicks = subtractNullableNumber(totals.clicks, sumNullableNumbers(rows.map((row) => row.clicks)));
  const addToCart = subtractNullableNumber(
    totals.addToCart,
    sumNullableNumbers(rows.map((row) => row.addToCart)),
  );
  const orders = subtractNullableNumber(
    totals.orders,
    sumNullableNumbers(rows.map((row) => getAdvertisingOrderedItems(row))),
  );
  const spend = subtractNullableNumber(totals.spend, sumNullableNumbers(rows.map((row) => row.spend)));

  return {
    ...totals,
    count: Math.max(0, totals.count - rows.length),
    jamQueryCount: subtractNullableNumber(totals.jamQueryCount, sumNullableNumbers(rows.map((row) => row.jamQueryCount))),
    jamFrequency: subtractNullableNumber(totals.jamFrequency, sumNullableNumbers(rows.map((row) => row.jamFrequency))),
    jamClicks: subtractNullableNumber(totals.jamClicks, sumNullableNumbers(rows.map((row) => row.jamClicks))),
    jamAddToCart: subtractNullableNumber(totals.jamAddToCart, sumNullableNumbers(rows.map((row) => row.jamAddToCart))),
    jamOrders: subtractNullableNumber(totals.jamOrders, sumNullableNumbers(rows.map((row) => row.jamOrders))),
    monthlyFrequency: subtractNullableNumber(
      totals.monthlyFrequency,
      sumNullableNumbers(rows.map((row) => row.monthlyFrequency)),
    ),
    views,
    clicks,
    ctr: getAdvertisingRatio(clicks, views),
    addToCart,
    ctc: getAdvertisingRatio(addToCart, clicks),
    orders,
    cto: getAdvertisingRatio(orders, addToCart),
    spend,
    cpc: getAdvertisingMoneyPerAction(spend, clicks),
    cpm: getAdvertisingCostPerThousand(spend, views),
    cpo: getAdvertisingMoneyPerAction(spend, orders),
    viewToOrder: getAdvertisingRatio(orders, views),
  };
}

function subtractNullableNumber(currentValue: number | null, subtractValue: number | null) {
  if (currentValue === null || subtractValue === null) {
    return currentValue;
  }

  return currentValue - subtractValue;
}

function sumNullableNumbers(values: Array<number | null>) {
  let total: number | null = null;

  for (const value of values) {
    if (value === null) {
      continue;
    }

    total = total === null ? value : total + value;
  }

  return total;
}

function buildClusterKey(advertId: number, clusterName: string) {
  return buildWorkspaceShellClusterKey(advertId, clusterName);
}
