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

/**
 * CPO с фоллбэком на spend.
 * Если заказов нет, возвращает полную сумму расходов, чтобы пользователь
 * видел, сколько потрачено при нулевой конверсии, а не пустую ячейку.
 */
export function getAdvertisingCpoOrSpend(
  spend: number | null,
  orders: number | null,
): number | null {
  if (spend === null) return null;
  if (orders !== null && orders > 0) return spend / orders;
  return spend > 0 ? spend : null;
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

/**
 * Знаменатель CPO = max(заказанные товары РК, джем-заказы): кластеру засчитываются
 * органические/джемовые заказы. РК-часть — shks ?? orders (как getAdvertisingOrderedItems).
 * JAM учитывается ТОЛЬКО в CPO — в колонке «Заказанные товары» и прочих метриках нет.
 * jamOrders отсутствует (null) → max сводится к РК-части. Та же формула в движке
 * автоматизации (decideForCluster: max(rkOrdered, ordersJam)).
 */
export function getAdvertisingCpoOrderedItems(input: {
  orders: number | null;
  shks?: number | null;
  jamOrders: number | null;
}): number | null {
  const rk = getAdvertisingOrderedItems(input);
  const jam = input.jamOrders;
  if (rk === null && jam === null) return null;
  return Math.max(rk ?? 0, jam ?? 0);
}

/**
 * Авто-обновляемый ли кластер по позиции в выдаче. Движок ставок постоянно зондирует место
 * ТОЛЬКО для активных заказных кластеров: max(заказы РК, JAM) > 0 && sourceKind === "active"
 * (см. product-cluster-bid-engine.service: фильтр `ordered`). Только у них место персистентно
 * и переживает перезаход/обновление; у остальных позиция эфемерна — показывается лишь после
 * ручного замера в текущей сессии и слетает при перезаходе. Зеркалит серверный критерий.
 */
export function isClusterPositionAutoMaintained(row: {
  sourceKind: string | null;
  orders: number | null;
  shks?: number | null;
  jamOrders: number | null;
  accruedOrders?: number | null;
}): boolean {
  if (row.sourceKind !== "active") return false;
  const periodOrders = getAdvertisingCpoOrderedItems(row) ?? 0; // max(РК, JAM)
  const accruedOrders = row.accruedOrders ?? 0;
  return Math.max(periodOrders, accruedOrders) > 0;
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
    return getAdvertisingCpoOrSpend(row.spend, getAdvertisingCpoOrderedItems(row));
  }

  if (key === "viewToOrder") {
    return getAdvertisingRatio(getAdvertisingOrderedItems(row), row.views);
  }

  return row[key];
}
