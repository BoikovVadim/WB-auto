import type { AdvertisingClusterQueryRow, AdvertisingClusterRow } from "./advertisingModelTypes";
import type { AdvertisingClusterNumericFilterKey } from "./advertisingTableTypes";

export function sumAdvertisingValues(values: Array<number | null>) {
  let hasValue = false;
  let total = 0;

  for (const value of values) {
    if (value === null) {
      continue;
    }
    hasValue = true;
    total += value;
  }

  return hasValue ? total : null;
}

export function averageAdvertisingValues(values: Array<number | null>) {
  let total = 0;
  let count = 0;

  for (const value of values) {
    if (value === null) {
      continue;
    }
    total += value;
    count += 1;
  }

  return count > 0 ? total / count : null;
}

export function getAdvertisingMoneyPerAction(
  spend: number | null,
  actions: number | null,
) {
  if (spend === null || actions === null || actions <= 0) {
    return null;
  }

  return spend / actions;
}

export function getAdvertisingCostPerThousand(
  spend: number | null,
  views: number | null,
) {
  if (spend === null || views === null || views <= 0) {
    return null;
  }

  return (spend / views) * 1000;
}

export function getAdvertisingRatio(
  numerator: number | null,
  denominator: number | null,
) {
  if (numerator === null || denominator === null || denominator <= 0) {
    return null;
  }

  return (numerator / denominator) * 100;
}

export function getAdvertisingOrderedItems(input: {
  orders: number | null;
  shks?: number | null;
}) {
  return typeof input.shks === "number" ? input.shks : input.orders;
}

export function hasJamMetrics(query: AdvertisingClusterQueryRow) {
  return (
    query.jamFrequency !== null ||
    query.jamClicks !== null ||
    query.jamAddToCart !== null ||
    query.jamOrders !== null ||
    query.jamAvgPosition !== null ||
    query.jamOpenToCart !== null
  );
}

export function addAdvertisingNullableNumbers(currentValue: number | null, nextValue: number | null) {
  if (currentValue === null) {
    return nextValue;
  }
  if (nextValue === null) {
    return currentValue;
  }

  return currentValue + nextValue;
}

export function coerceAdvertisingProjectedTotal(value: number | null) {
  return value ?? 0;
}

export function readAdvertisingNumericValue(
  row: AdvertisingClusterRow,
  key: AdvertisingClusterNumericFilterKey,
) {
  if (key === "jamCtc") {
    return getAdvertisingRatio(row.jamAddToCart, row.jamClicks);
  }

  if (key === "jamCto") {
    return getAdvertisingRatio(row.jamOrders, row.jamAddToCart);
  }

  if (key === "jamAvgPosition") {
    return row.jamAvgPosition;
  }

  if (key === "ctc") {
    return getAdvertisingRatio(row.addToCart, row.clicks);
  }

  if (key === "cto") {
    return getAdvertisingRatio(getAdvertisingOrderedItems(row), row.addToCart);
  }

  if (key === "cpo") {
    return getAdvertisingMoneyPerAction(row.spend, getAdvertisingOrderedItems(row));
  }

  if (key === "viewToOrder") {
    return getAdvertisingRatio(getAdvertisingOrderedItems(row), row.views);
  }

  return row[key];
}
