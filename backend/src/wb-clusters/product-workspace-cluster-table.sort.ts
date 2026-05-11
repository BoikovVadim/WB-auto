import type {
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingWorkspaceClusterSortDirection,
  ProductAdvertisingWorkspaceClusterSortKey,
} from "./wb-clusters.types";
import {
  getWorkspaceMoneyPerAction,
  getWorkspaceOrderedItems,
  getWorkspaceRatio,
  isWorkspaceClusterExcluded,
} from "./product-workspace.builder";

export function compareWorkspaceClusterRows(
  left: ProductAdvertisingWorkspaceClusterRow,
  right: ProductAdvertisingWorkspaceClusterRow,
  sortKey: ProductAdvertisingWorkspaceClusterSortKey,
  direction: ProductAdvertisingWorkspaceClusterSortDirection,
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
                        ? compareNullableNumbers(
                            getWorkspaceRatio(left.jamAddToCart, left.jamClicks),
                            getWorkspaceRatio(right.jamAddToCart, right.jamClicks),
                            direction,
                          )
                        : sortKey === "jamCto"
                          ? compareNullableNumbers(
                              getWorkspaceRatio(left.jamOrders, left.jamAddToCart),
                              getWorkspaceRatio(right.jamOrders, right.jamAddToCart),
                              direction,
                            )
                          : sortKey === "monthlyFrequency"
                            ? compareNullableNumbers(left.monthlyFrequency, right.monthlyFrequency, direction)
                            : sortKey === "bid"
                              ? compareNullableNumbers(left.bid, right.bid, direction)
                              : sortKey === "views"
                                ? compareNullableNumbers(left.views, right.views, direction)
                                : sortKey === "clicks"
                                  ? compareNullableNumbers(left.clicks, right.clicks, direction)
                                  : sortKey === "ctr"
                                    ? compareNullableNumbers(left.ctr, right.ctr, direction)
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
                                                getWorkspaceRatio(
                                                  getWorkspaceOrderedItems(left),
                                                  left.addToCart,
                                                ),
                                                getWorkspaceRatio(
                                                  getWorkspaceOrderedItems(right),
                                                  right.addToCart,
                                                ),
                                                direction,
                                              )
                                            : sortKey === "avgPosition"
                                              ? compareNullableNumbers(left.avgPosition, right.avgPosition, direction)
                                              : sortKey === "cpc"
                                                ? compareNullableNumbers(left.cpc, right.cpc, direction)
                                                : sortKey === "cpm"
                                                  ? compareNullableNumbers(left.cpm, right.cpm, direction)
                                                  : sortKey === "cpo"
                                                    ? compareNullableNumbers(
                                                        getWorkspaceMoneyPerAction(
                                                          left.spend,
                                                          getWorkspaceOrderedItems(left),
                                                        ),
                                                        getWorkspaceMoneyPerAction(
                                                          right.spend,
                                                          getWorkspaceOrderedItems(right),
                                                        ),
                                                        direction,
                                                      )
                                                    : sortKey === "viewToOrder"
                                                      ? compareNullableNumbers(
                                                          getWorkspaceRatio(
                                                            getWorkspaceOrderedItems(left),
                                                            left.views,
                                                          ),
                                                          getWorkspaceRatio(
                                                            getWorkspaceOrderedItems(right),
                                                            right.views,
                                                          ),
                                                          direction,
                                                        )
                                                      : compareNullableNumbers(
                                                          left.spend,
                                                          right.spend,
                                                          direction,
                                                        );

  if (byMetric !== 0) {
    return byMetric;
  }

  const byClusterName = compareNullableStrings(left.clusterName, right.clusterName, "asc");
  if (byClusterName !== 0) {
    return byClusterName;
  }

  return compareNullableNumbers(left.advertId, right.advertId, "asc");
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

function getClusterStatusLabel(row: ProductAdvertisingWorkspaceClusterRow) {
  return isWorkspaceClusterExcluded(row) ? "Неактивен" : "Активен";
}

