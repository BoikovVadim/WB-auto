import type {
  ProductAdvertisingClusterQuery,
  ProductAdvertisingWorkspaceClusterQueriesResponse,
  ProductAdvertisingWorkspaceClusterSortDirection,
  ProductAdvertisingWorkspaceClusterSortKey,
  ProductAdvertisingSheetResponse,
} from "./wb-clusters.types";
import {
  getWorkspaceOrderedItems,
  getWorkspaceRatio,
} from "./product-workspace.builder";
import { normalizeWorkspaceText } from "./product-workspace.builder";
import { buildProductAdvertisingReadModelRevision } from "./product-advertising-read-model-revision";
import { buildWorkspaceClusterKey } from "./product-workspace-cluster-table.builder";

export function buildProductAdvertisingWorkspaceClusterQueriesResponse(input: {
  sheet: ProductAdvertisingSheetResponse;
  advertId: number;
  clusterKey: string;
  clusterName?: string;
  sortKey: ProductAdvertisingWorkspaceClusterSortKey;
  sortDirection: ProductAdvertisingWorkspaceClusterSortDirection;
}): ProductAdvertisingWorkspaceClusterQueriesResponse {
  const queries = dedupeCanonicalClusterQueries(
    input.sheet.clusterQueries
      .filter((query) => query.advertId === input.advertId)
      .filter(
        (query) => buildWorkspaceClusterKey(query.advertId, query.clusterName) === input.clusterKey,
      )
      .filter((query) => query.isCanonicalClusterQuery),
  ).sort((left, right) =>
    compareWorkspaceClusterQueryRows(left, right, input.sortKey, input.sortDirection),
  );
  const resolvedClusterName = input.clusterName ?? queries[0]?.clusterName ?? resolveClusterName(input.clusterKey);

  return {
    nmId: input.sheet.nmId,
    advertId: input.advertId,
    clusterKey: input.clusterKey,
    clusterName: resolvedClusterName,
    checkedAt: input.sheet.checkedAt,
    revision: buildProductAdvertisingReadModelRevision({
      scope: "cluster_queries",
      nmId: input.sheet.nmId,
      advertId: input.advertId,
      clusterKey: input.clusterKey,
      requestedStartDate: input.sheet.range.startDate,
      requestedEndDate: input.sheet.range.endDate,
      builtAt: input.sheet.checkedAt,
    }),
    readiness: {
      scope: "cluster_queries",
      status: "ready",
      source: "sheet_snapshot",
      materializationStatus: "fallback_sheet",
    },
    queries,
    sort: {
      key: input.sortKey,
      direction: input.sortDirection,
    },
  };
}

function resolveClusterName(clusterKey: string) {
  const separatorIndex = clusterKey.indexOf(":");
  if (separatorIndex === -1) {
    return clusterKey;
  }

  return clusterKey.slice(separatorIndex + 1);
}

function dedupeCanonicalClusterQueries(rows: ProductAdvertisingClusterQuery[]) {
  const uniqueQueries = new Map<string, ProductAdvertisingClusterQuery>();

  for (const row of rows) {
    const key = normalizeWorkspaceText(row.queryText);
    if (!key) {
      continue;
    }

    if (!uniqueQueries.has(key)) {
      uniqueQueries.set(key, row);
    }
  }

  return Array.from(uniqueQueries.values());
}

function compareWorkspaceClusterQueryRows(
  left: ProductAdvertisingClusterQuery,
  right: ProductAdvertisingClusterQuery,
  sortKey: ProductAdvertisingWorkspaceClusterSortKey,
  direction: ProductAdvertisingWorkspaceClusterSortDirection,
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
                            getWorkspaceRatio(left.jamOrders, left.jamAddToCart),
                            getWorkspaceRatio(right.jamOrders, right.jamAddToCart),
                            direction,
                          )
                        : sortKey === "monthlyFrequency"
                          ? compareNullableNumbers(left.monthlyFrequency, right.monthlyFrequency, direction)
                          : sortKey === "bid"
                            ? compareNullableNumbers(null, null, direction)
                            : sortKey === "views"
                              ? compareNullableNumbers(left.views, right.views, direction)
                              : sortKey === "clicks"
                                ? compareNullableNumbers(left.clicks, right.clicks, direction)
                                : sortKey === "ctr"
                                  ? compareNullableNumbers(
                                      getWorkspaceRatio(left.clicks, left.views),
                                      getWorkspaceRatio(right.clicks, right.views),
                                      direction,
                                    )
                                  : sortKey === "addToCart"
                                    ? compareNullableNumbers(left.addToCart, right.addToCart, direction)
                                    : sortKey === "ctc"
                                      ? compareNullableNumbers(
                                          getWorkspaceRatio(left.addToCart, left.clicks),
                                          getWorkspaceRatio(right.addToCart, right.clicks),
                                          direction,
                                        )
                                      : sortKey === "orders"
                                        ? compareNullableNumbers(
                                            getWorkspaceOrderedItems(left),
                                            getWorkspaceOrderedItems(right),
                                            direction,
                                          )
                                        : sortKey === "cto"
                                          ? compareNullableNumbers(
                                              getWorkspaceRatio(getWorkspaceOrderedItems(left), left.addToCart),
                                              getWorkspaceRatio(getWorkspaceOrderedItems(right), right.addToCart),
                                              direction,
                                            )
                                          : sortKey === "avgPosition" ||
                                              sortKey === "cpc" ||
                                              sortKey === "cpm" ||
                                              sortKey === "cpo" ||
                                              sortKey === "spend"
                                            ? compareNullableNumbers(null, null, direction)
                                            : compareNullableNumbers(
                                                getWorkspaceRatio(
                                                  getWorkspaceOrderedItems(left),
                                                  left.views,
                                                ),
                                                getWorkspaceRatio(
                                                  getWorkspaceOrderedItems(right),
                                                  right.views,
                                                ),
                                                direction,
                                              );

  if (byMetric !== 0) {
    return byMetric;
  }

  return compareNullableStrings(left.queryText, right.queryText, "asc");
}

function compareNullableNumbers(
  left: number | null,
  right: number | null,
  direction: ProductAdvertisingWorkspaceClusterSortDirection,
) {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return direction === "asc" ? left - right : right - left;
}

function compareNullableStrings(
  left: string | null,
  right: string | null,
  direction: ProductAdvertisingWorkspaceClusterSortDirection,
) {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return direction === "asc"
    ? left.localeCompare(right, "ru")
    : right.localeCompare(left, "ru");
}

function getQueryStatusLabel(query: ProductAdvertisingClusterQuery) {
  return query.isActive === false || query.sourceKind === "excluded" ? "Неактивен" : "Активен";
}
