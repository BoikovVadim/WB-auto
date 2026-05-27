import type {
  ProductAdvertisingClusterQuery,
  ProductAdvertisingWorkspaceClusterQueriesResponse,
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingWorkspaceClusterTableResponse,
} from "../../../api/syncClient";
import {
  getAdvertisingCostPerThousand,
  getAdvertisingCpoOrSpend,
  getAdvertisingMoneyPerAction,
  getAdvertisingOrderedItems,
  getAdvertisingRatio,
  isClusterActive,
  isClusterExcluded,
} from "./model";
import {
  compareNullableNumbers,
  compareNullableStrings,
} from "./advertisingModelComparison";

export function buildLocalWorkspaceClusterTableResponse(input: {
  snapshot: ProductAdvertisingWorkspaceClusterTableResponse;
  search: string;
  status: ProductAdvertisingWorkspaceClusterTableResponse["appliedFilters"]["status"];
  numericFilters: ProductAdvertisingWorkspaceClusterTableResponse["appliedFilters"]["numericFilters"];
  sortKey: ProductAdvertisingWorkspaceClusterTableResponse["sort"]["key"];
  sortDirection: ProductAdvertisingWorkspaceClusterTableResponse["sort"]["direction"];
  page: number;
  pageSize: number;
}): ProductAdvertisingWorkspaceClusterTableResponse {
  return buildWorkspaceClusterTableView({
    snapshot: input.snapshot,
    search: input.search,
    status: input.status,
    numericFilters: input.numericFilters,
    sortKey: input.sortKey,
    sortDirection: input.sortDirection,
    page: input.page,
    pageSize: input.pageSize,
  });
}

export function buildWorkspaceClusterTableView(input: {
  snapshot: Pick<
    ProductAdvertisingWorkspaceClusterTableResponse,
    | "nmId"
    | "advertId"
    | "checkedAt"
    | "revision"
    | "readiness"
    | "rows"
    | "querySearchIndex"
    | "filterCounts"
  >;
  search: string;
  status: ProductAdvertisingWorkspaceClusterTableResponse["appliedFilters"]["status"];
  numericFilters: ProductAdvertisingWorkspaceClusterTableResponse["appliedFilters"]["numericFilters"];
  sortKey: ProductAdvertisingWorkspaceClusterTableResponse["sort"]["key"];
  sortDirection: ProductAdvertisingWorkspaceClusterTableResponse["sort"]["direction"];
  page: number;
  pageSize: number;
}): ProductAdvertisingWorkspaceClusterTableResponse {
  const searchValue = input.search.trim();
  const querySearchIndex = new Map(Object.entries(input.snapshot.querySearchIndex ?? {}));
  const filteredRows = input.snapshot.rows
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
    ...input.snapshot,
    rows: filteredRows.slice(startIndex, startIndex + pageSize),
    totals: buildClusterTableTotals(filteredRows),
    totalsScope: "filtered_population",
    appliedFilters: {
      search: searchValue,
      clusterNameSearch: "",
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

export function buildLocalWorkspaceClusterQueriesResponse(input: {
  snapshot: ProductAdvertisingWorkspaceClusterQueriesResponse;
  sortKey: ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["key"];
  sortDirection: ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["direction"];
}): ProductAdvertisingWorkspaceClusterQueriesResponse {
  return buildWorkspaceClusterQueriesView({
    snapshot: input.snapshot,
    sortKey: input.sortKey,
    sortDirection: input.sortDirection,
  });
}

export function buildWorkspaceClusterQueriesView(input: {
  snapshot: Pick<
    ProductAdvertisingWorkspaceClusterQueriesResponse,
    | "nmId"
    | "advertId"
    | "clusterKey"
    | "clusterName"
    | "checkedAt"
    | "revision"
    | "readiness"
    | "queries"
  >;
  sortKey: ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["key"];
  sortDirection: ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["direction"];
}): ProductAdvertisingWorkspaceClusterQueriesResponse {
  return {
    ...input.snapshot,
    queries: [...input.snapshot.queries].sort((left, right) =>
      compareWorkspaceClusterQueryRows(left, right, input.sortKey, input.sortDirection),
    ),
    sort: {
      key: input.sortKey,
      direction: input.sortDirection,
    },
  };
}

function matchesClusterSearch(
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

function matchesClusterStatusFilter(
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

function matchesClusterNumericFilters(
  row: ProductAdvertisingWorkspaceClusterRow,
  numericFilters: ProductAdvertisingWorkspaceClusterTableResponse["appliedFilters"]["numericFilters"],
) {
  for (const [key, filter] of Object.entries(numericFilters)) {
    const value = readClusterMetricValue(
      row,
      key as keyof ProductAdvertisingWorkspaceClusterTableResponse["appliedFilters"]["numericFilters"],
    );
    if (filter.min !== null && (value === null || value < filter.min)) {
      return false;
    }
    if (filter.max !== null && (value === null || value > filter.max)) {
      return false;
    }
  }

  return true;
}

function readClusterMetricValue(
  row: ProductAdvertisingWorkspaceClusterRow,
  key: keyof ProductAdvertisingWorkspaceClusterTableResponse["appliedFilters"]["numericFilters"],
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
      return getAdvertisingRatio(row.jamAddToCart, row.jamClicks);
    case "jamCto":
      return getAdvertisingRatio(row.jamOrders, row.jamAddToCart);
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
      return getAdvertisingRatio(row.addToCart, row.clicks);
    case "orders":
      return getAdvertisingOrderedItems(row);
    case "cto":
      return getAdvertisingRatio(getAdvertisingOrderedItems(row), row.addToCart);
    case "avgPosition":
      return row.avgPosition;
    case "cpc":
      return row.cpc;
    case "cpm":
      return row.cpm;
    case "cpo":
      return getAdvertisingCpoOrSpend(row.spend, getAdvertisingOrderedItems(row));
    case "viewToOrder":
      return getAdvertisingRatio(getAdvertisingOrderedItems(row), row.views);
    case "spend":
      return row.spend;
  }
}

export function compareWorkspaceClusterRows(
  left: ProductAdvertisingWorkspaceClusterRow,
  right: ProductAdvertisingWorkspaceClusterRow,
  sortKey: ProductAdvertisingWorkspaceClusterTableResponse["sort"]["key"],
  direction: ProductAdvertisingWorkspaceClusterTableResponse["sort"]["direction"],
) {
  const byMetric =
    sortKey === "source"
      ? compareNullableStrings(getClusterStatusLabel(left), getClusterStatusLabel(right), direction)
      : sortKey === "advertId"
        ? compareNullableNumbers(left.advertId, right.advertId, direction)
        : sortKey === "campaignName"
          ? compareNullableStrings(left.campaignName, right.campaignName, direction)
          : sortKey === "clusterName"
            ? compareNullableStrings(left.clusterName, right.clusterName, direction)
            : compareNullableNumbers(readClusterMetricValue(left, sortKey), readClusterMetricValue(right, sortKey), direction);

  if (byMetric !== 0) {
    return byMetric;
  }

  const byClusterName = compareNullableStrings(left.clusterName, right.clusterName, "asc");
  if (byClusterName !== 0) {
    return byClusterName;
  }

  return compareNullableNumbers(left.advertId, right.advertId, "asc");
}

function buildClusterTableTotals(
  rows: ProductAdvertisingWorkspaceClusterRow[],
): ProductAdvertisingWorkspaceClusterTableResponse["totals"] {
  const views = sumNullableNumbers(rows.map((row) => row.views));
  const clicks = sumNullableNumbers(rows.map((row) => row.clicks));
  const addToCart = sumNullableNumbers(rows.map((row) => row.addToCart));
  const orders = sumNullableNumbers(rows.map((row) => getAdvertisingOrderedItems(row)));
  const spend = sumNullableNumbers(rows.map((row) => row.spend));

  return {
    count: rows.length,
    jamQueryCount: sumNullableNumbers(rows.map((row) => row.jamQueryCount)),
    jamFrequency: sumNullableNumbers(rows.map((row) => row.jamFrequency)),
    jamClicks: sumNullableNumbers(rows.map((row) => row.jamClicks)),
    jamAddToCart: sumNullableNumbers(rows.map((row) => row.jamAddToCart)),
    jamOrders: sumNullableNumbers(rows.map((row) => row.jamOrders)),
    jamAvgPosition: averageNullableNumbers(rows.map((row) => row.jamAvgPosition)),
    monthlyFrequency: sumNullableNumbers(rows.map((row) => row.monthlyFrequency)),
    bid: averageNullableNumbers(rows.map((row) => row.bid)),
    views,
    clicks,
    ctr: getAdvertisingRatio(clicks, views),
    addToCart,
    ctc: getAdvertisingRatio(addToCart, clicks),
    orders,
    cto: getAdvertisingRatio(orders, addToCart),
    avgPosition: averageNullableNumbers(rows.map((row) => row.avgPosition)),
    cpc: getAdvertisingMoneyPerAction(spend, clicks),
    cpm: getAdvertisingCostPerThousand(spend, views),
    cpo: getAdvertisingCpoOrSpend(spend, orders),
    viewToOrder: getAdvertisingRatio(orders, views),
    spend,
    currency:
      rows.find((row) => typeof row.currency === "string" && row.currency.length > 0)?.currency ??
      null,
  };
}

function compareWorkspaceClusterQueryRows(
  left: ProductAdvertisingClusterQuery,
  right: ProductAdvertisingClusterQuery,
  sortKey: ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["key"],
  direction: ProductAdvertisingWorkspaceClusterQueriesResponse["sort"]["direction"],
) {
  const byMetric =
    sortKey === "source"
      ? compareNullableStrings(getQueryStatusLabel(left), getQueryStatusLabel(right), direction)
      : sortKey === "advertId"
        ? compareNullableNumbers(left.advertId, right.advertId, direction)
        : sortKey === "campaignName" || sortKey === "clusterName"
          ? compareNullableStrings(left.queryText, right.queryText, direction)
          : sortKey === "jamFrequency"
            ? compareNullableNumbers(left.jamFrequency, right.jamFrequency, direction)
            : sortKey === "jamClicks"
              ? compareNullableNumbers(left.jamClicks, right.jamClicks, direction)
              : sortKey === "jamAddToCart"
                ? compareNullableNumbers(left.jamAddToCart, right.jamAddToCart, direction)
                : sortKey === "jamOrders"
                  ? compareNullableNumbers(left.jamOrders, right.jamOrders, direction)
                  : sortKey === "jamAvgPosition"
                    ? compareNullableNumbers(left.jamAvgPosition, right.jamAvgPosition, direction)
                    : sortKey === "jamCtc"
                      ? compareNullableNumbers(left.jamOpenToCart, right.jamOpenToCart, direction)
                      : sortKey === "jamCto"
                        ? compareNullableNumbers(
                            getAdvertisingRatio(left.jamOrders, left.jamAddToCart),
                            getAdvertisingRatio(right.jamOrders, right.jamAddToCart),
                            direction,
                          )
                        : sortKey === "monthlyFrequency"
                          ? compareNullableNumbers(left.monthlyFrequency, right.monthlyFrequency, direction)
                          : sortKey === "views"
                            ? compareNullableNumbers(left.views, right.views, direction)
                            : sortKey === "clicks"
                              ? compareNullableNumbers(left.clicks, right.clicks, direction)
                              : sortKey === "ctr"
                                ? compareNullableNumbers(
                                    getAdvertisingRatio(left.clicks, left.views),
                                    getAdvertisingRatio(right.clicks, right.views),
                                    direction,
                                  )
                                : sortKey === "addToCart"
                                  ? compareNullableNumbers(left.addToCart, right.addToCart, direction)
                                  : sortKey === "ctc"
                                    ? compareNullableNumbers(
                                        getAdvertisingRatio(left.addToCart, left.clicks),
                                        getAdvertisingRatio(right.addToCart, right.clicks),
                                        direction,
                                      )
                                    : sortKey === "orders"
                                      ? compareNullableNumbers(
                                          getAdvertisingOrderedItems(left),
                                          getAdvertisingOrderedItems(right),
                                          direction,
                                        )
                                      : sortKey === "cto"
                                        ? compareNullableNumbers(
                                            getAdvertisingRatio(
                                              getAdvertisingOrderedItems(left),
                                              left.addToCart,
                                            ),
                                            getAdvertisingRatio(
                                              getAdvertisingOrderedItems(right),
                                              right.addToCart,
                                            ),
                                            direction,
                                          )
                                        : sortKey === "viewToOrder"
                                          ? compareNullableNumbers(
                                              getAdvertisingRatio(
                                                getAdvertisingOrderedItems(left),
                                                left.views,
                                              ),
                                              getAdvertisingRatio(
                                                getAdvertisingOrderedItems(right),
                                                right.views,
                                              ),
                                              direction,
                                            )
                                          : compareNullableNumbers(null, null, direction);

  if (byMetric !== 0) {
    return byMetric;
  }

  return compareNullableStrings(left.queryText, right.queryText, "asc");
}

function getClusterStatusLabel(row: ProductAdvertisingWorkspaceClusterRow) {
  return isClusterExcluded(row) ? "Неактивен" : "Активен";
}

function getQueryStatusLabel(query: ProductAdvertisingClusterQuery) {
  return query.isActive === false || query.sourceKind === "excluded" ? "Неактивен" : "Активен";
}

function normalizeClusterSearchText(value: string) {
  return value.trim().toLocaleLowerCase("ru");
}

function sumNullableNumbers(values: Array<number | null>) {
  let total: number | null = null;

  for (const value of values) {
    total = addNullableNumbers(total, value);
  }

  return total;
}

function averageNullableNumbers(values: Array<number | null>) {
  const nonNullValues = values.filter((value): value is number => typeof value === "number");
  if (nonNullValues.length === 0) {
    return null;
  }

  return nonNullValues.reduce((total, value) => total + value, 0) / nonNullValues.length;
}

function addNullableNumbers(currentValue: number | null, nextValue: number | null) {
  if (currentValue === null) {
    return nextValue;
  }

  if (nextValue === null) {
    return currentValue;
  }

  return currentValue + nextValue;
}
