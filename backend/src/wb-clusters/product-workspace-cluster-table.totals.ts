import type {
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingWorkspaceClusterTableTotals,
} from "./wb-clusters.types";
import {
  addWorkspaceNullableNumbers,
  getWorkspaceCostPerThousand,
  getWorkspaceMoneyPerAction,
  getWorkspaceOrderedItems,
  getWorkspaceRatio,
} from "./product-workspace.builder";

export function buildClusterTableTotals(
  rows: ProductAdvertisingWorkspaceClusterRow[],
): ProductAdvertisingWorkspaceClusterTableTotals {
  const views = sumNullableNumbers(rows.map((row) => row.views));
  const clicks = sumNullableNumbers(rows.map((row) => row.clicks));
  const addToCart = sumNullableNumbers(rows.map((row) => row.addToCart));
  const orders = sumNullableNumbers(rows.map((row) => getWorkspaceOrderedItems(row)));
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
    ctr: getWorkspaceRatio(clicks, views),
    addToCart,
    ctc: getWorkspaceRatio(addToCart, clicks),
    orders,
    cto: getWorkspaceRatio(orders, addToCart),
    avgPosition: averageNullableNumbers(rows.map((row) => row.avgPosition)),
    cpc: getWorkspaceMoneyPerAction(spend, clicks),
    cpm: getWorkspaceCostPerThousand(spend, views),
    cpo: getWorkspaceMoneyPerAction(spend, orders),
    viewToOrder: getWorkspaceRatio(orders, views),
    spend,
    currency:
      rows.find((row) => typeof row.currency === "string" && row.currency.length > 0)?.currency ?? null,
  };
}

function sumNullableNumbers(values: Array<number | null>) {
  let total: number | null = null;

  for (const value of values) {
    total = addWorkspaceNullableNumbers(total, value);
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

