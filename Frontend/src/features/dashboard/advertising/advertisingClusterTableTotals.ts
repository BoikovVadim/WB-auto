import type {
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingWorkspaceClusterTableTotals,
} from "../../../api/syncClient";
import {
  getAdvertisingCpoOrSpend,
  getAdvertisingCpoOrderedItems,
} from "./advertisingModelMetrics";

export function getEmptyAdvertisingClusterTotals(currency: string | null) {
  return {
    count: 0,
    jamQueryCount: null,
    jamFrequency: null,
    jamClicks: null,
    jamAddToCart: null,
    jamOrders: null,
    jamAvgPosition: null,
    monthlyFrequency: null,
    bid: null,
    views: null,
    clicks: null,
    ctr: null,
    addToCart: null,
    ctc: null,
    orders: null,
    cto: null,
    avgPosition: null,
    cpc: null,
    cpm: null,
    cpo: null,
    viewToOrder: null,
    spend: null,
    currency,
  };
}

function sumNullable(values: Array<number | null>): number | null {
  let hasValue = false;
  let total = 0;
  for (const v of values) {
    if (v !== null) {
      hasValue = true;
      total += v;
    }
  }
  return hasValue ? total : null;
}

function weightedAvgNullable(
  values: Array<number | null>,
  weights: Array<number | null>,
): number | null {
  let totalWeight = 0;
  let weightedSum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const w = weights[i];
    if (v !== null && w !== null && w > 0) {
      weightedSum += v * w;
      totalWeight += w;
    }
  }
  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

function perUnit(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}

/**
 * Вычисляет итоговую строку на стороне клиента из переданного набора строк.
 * Используется при клиентской фильтрации (active/excluded), чтобы итоги
 * соответствовали видимому подмножеству кластеров, а не всему серверному ответу.
 */
export function computeClusterTotalsFromRows(
  rows: ProductAdvertisingWorkspaceClusterRow[],
  currency: string | null,
): ProductAdvertisingWorkspaceClusterTableTotals {
  const views = sumNullable(rows.map((r) => r.views));
  const clicks = sumNullable(rows.map((r) => r.clicks));
  const orders = sumNullable(rows.map((r) => r.orders));
  const addToCart = sumNullable(rows.map((r) => r.addToCart));
  const spend = sumNullable(rows.map((r) => r.spend));
  const jamClicks = sumNullable(rows.map((r) => r.jamClicks));
  const jamAddToCart = sumNullable(rows.map((r) => r.jamAddToCart));
  const jamOrders = sumNullable(rows.map((r) => r.jamOrders));
  // Знаменатель CPO = Σ max(заказы РК, джем-заказы) по строкам (та же формула, что per-row).
  const cpoOrders = sumNullable(rows.map((r) => getAdvertisingCpoOrderedItems(r)));

  return {
    count: rows.length,
    jamQueryCount: sumNullable(rows.map((r) => r.jamQueryCount)),
    jamFrequency: sumNullable(rows.map((r) => r.jamFrequency)),
    jamClicks,
    jamAddToCart,
    jamOrders,
    jamAvgPosition: weightedAvgNullable(
      rows.map((r) => r.jamAvgPosition),
      rows.map((r) => r.jamClicks),
    ),
    monthlyFrequency: sumNullable(rows.map((r) => r.monthlyFrequency)),
    bid: weightedAvgNullable(
      rows.map((r) => r.bid),
      rows.map((r) => (r.bid !== null ? 1 : null)),
    ),
    views,
    clicks,
    ctr: ratio(clicks, views),
    addToCart,
    ctc: ratio(addToCart, clicks),
    orders,
    cto: ratio(orders, addToCart),
    avgPosition: weightedAvgNullable(
      rows.map((r) => r.avgPosition),
      rows.map((r) => r.views),
    ),
    cpc: perUnit(spend, clicks),
    cpm:
      spend !== null && views !== null && views > 0 ? (spend / views) * 1000 : null,
    cpo: getAdvertisingCpoOrSpend(spend, cpoOrders),
    viewToOrder: ratio(orders, views),
    spend,
    currency,
  };
}
