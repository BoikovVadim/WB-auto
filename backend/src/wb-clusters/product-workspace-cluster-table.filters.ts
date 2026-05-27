import type {
  ProductAdvertisingSheetResponse,
  ProductAdvertisingWorkspaceClusterNumericFilterKey,
  ProductAdvertisingWorkspaceClusterNumericFilters,
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingWorkspaceClusterStatusFilter,
} from "./wb-clusters.types";
import {
  getWorkspaceMoneyPerAction,
  getWorkspaceOrderedItems,
  getWorkspaceRatio,
  isWorkspaceClusterActive,
  isWorkspaceClusterExcluded,
  normalizeWorkspaceText,
} from "./product-workspace.builder";

export function buildWorkspaceClusterKey(advertId: number | null, clusterName: string) {
  return `${advertId ?? "none"}:${normalizeWorkspaceText(clusterName)}`;
}

export function normalizeClusterSearchText(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/[_/\\|.,:;!?()[\]{}"'+=*%#№@`~^&-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildClusterQuerySearchIndex(
  rows: ProductAdvertisingSheetResponse["clusterQueries"],
  advertId: number,
) {
  const queriesByCluster = new Map<string, string[]>();

  for (const row of rows) {
    if (row.advertId !== advertId) {
      continue;
    }

    const key = buildWorkspaceClusterKey(row.advertId, row.clusterName);
    const normalizedText = normalizeClusterSearchText(row.queryText);
    if (!normalizedText) {
      continue;
    }

    const currentQueries = queriesByCluster.get(key);
    if (currentQueries) {
      currentQueries.push(normalizedText);
      continue;
    }

    queriesByCluster.set(key, [normalizedText]);
  }

  return queriesByCluster;
}

export function matchesClusterSearch(
  row: ProductAdvertisingWorkspaceClusterRow,
  search: string,
  querySearchIndex: Map<string, string[]>,
) {
  const normalizedSearch = normalizeClusterSearchText(search);
  if (!normalizedSearch) {
    return true;
  }

  if (normalizeClusterSearchText(row.clusterName).includes(normalizedSearch)) {
    return true;
  }

  const queries = querySearchIndex.get(row.clusterKey) ?? [];
  return queries.some((query) => query.includes(normalizedSearch));
}

export function matchesClusterNameSearch(
  row: ProductAdvertisingWorkspaceClusterRow,
  search: string,
) {
  const normalizedSearch = normalizeClusterSearchText(search);
  if (!normalizedSearch) {
    return true;
  }

  return normalizeClusterSearchText(row.clusterName).includes(normalizedSearch);
}

export function matchesClusterStatusFilter(
  row: ProductAdvertisingWorkspaceClusterRow,
  status: ProductAdvertisingWorkspaceClusterStatusFilter,
) {
  if (status === "active") {
    return isWorkspaceClusterActive(row);
  }

  if (status === "excluded") {
    return isWorkspaceClusterExcluded(row);
  }

  return true;
}

const numericFilterKeys: ProductAdvertisingWorkspaceClusterNumericFilterKey[] = [
  "jamFrequency",
  "jamClicks",
  "jamAddToCart",
  "jamOrders",
  "jamAvgPosition",
  "jamCtc",
  "jamCto",
  "monthlyFrequency",
  "bid",
  "views",
  "clicks",
  "ctr",
  "addToCart",
  "ctc",
  "orders",
  "cto",
  "avgPosition",
  "cpc",
  "cpm",
  "cpo",
  "viewToOrder",
  "spend",
];

export function matchesClusterNumericFilters(
  row: ProductAdvertisingWorkspaceClusterRow,
  numericFilters: ProductAdvertisingWorkspaceClusterNumericFilters,
) {
  return numericFilterKeys.every((key) => {
    const filter = numericFilters[key];
    const value = getClusterMetricValue(row, key);
    if (filter.min !== null && (value === null || value < filter.min)) {
      return false;
    }
    if (filter.max !== null && (value === null || value > filter.max)) {
      return false;
    }
    return true;
  });
}

function getClusterMetricValue(
  row: ProductAdvertisingWorkspaceClusterRow,
  key: ProductAdvertisingWorkspaceClusterNumericFilterKey,
) {
  switch (key) {
    case "jamFrequency":
      return row.jamFrequency;
    case "jamClicks":
      return row.jamClicks;
    case "jamAddToCart":
      return row.jamAddToCart;
    case "jamOrders":
      return row.jamOrders;
    case "jamAvgPosition":
      return row.jamAvgPosition;
    case "jamCtc":
      return getWorkspaceRatio(row.jamAddToCart, row.jamClicks);
    case "jamCto":
      return getWorkspaceRatio(row.jamOrders, row.jamAddToCart);
    case "monthlyFrequency":
      return row.monthlyFrequency;
    case "bid":
      return row.bid;
    case "views":
      return row.views;
    case "clicks":
      return row.clicks;
    case "ctr":
      return row.ctr;
    case "addToCart":
      return row.addToCart;
    case "ctc":
      return getWorkspaceRatio(row.addToCart, row.clicks);
    case "orders":
      return getWorkspaceOrderedItems(row);
    case "cto":
      return getWorkspaceRatio(getWorkspaceOrderedItems(row), row.addToCart);
    case "avgPosition":
      return row.avgPosition;
    case "cpc":
      return row.cpc;
    case "cpm":
      return row.cpm;
    case "cpo":
      return getWorkspaceMoneyPerAction(row.spend, getWorkspaceOrderedItems(row));
    case "viewToOrder":
      return getWorkspaceRatio(getWorkspaceOrderedItems(row), row.views);
    case "spend":
      return row.spend;
  }
}

