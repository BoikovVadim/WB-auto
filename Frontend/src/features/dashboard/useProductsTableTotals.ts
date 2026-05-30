import { useMemo } from "react";

import type { TodayBuyoutCount } from "../../api/syncClientBuyouts";
import type { TodayOrderCount } from "../../api/syncClientOrders";
import type { ProductListItem } from "./useDashboardProductsWorkspace";

export type ProductsTableTotals = {
  totalOrders: number;
  totalStocks: number | null;
  totalOrdersSum: number | null;
  totalBuyoutPercent: number | null;
  totalRevenue: number | null;
  totalCostSum: number | null;
  totalAdSpend: number | null;
  totalCommission: number | null;
  totalAcquiring: number | null;
  totalDrr: number | null;
  totalSpp: number | null;
};

type Input = {
  filteredProducts: ProductListItem[];
  orderCounts: Map<number, TodayOrderCount>;
  rollingBuyoutCounts: Map<number, TodayBuyoutCount>;
  stockCounts: Map<number, number>;
  ordersSumValues: Map<number, number>;
  revenueValues: Map<number, number>;
  costSumValues: Map<number, number>;
  adSpendValues: Map<number, number>;
  commissionValues: Map<number, number>;
  acquiringValues: Map<number, number>;
  drrValues: Map<number, number>;
  sppValues: Map<number, number>;
};

/** Сумма по товарам из карты значений; null, если ни у одного нет значения (>0 при positiveOnly). */
function sumOverProducts(
  products: ProductListItem[],
  values: Map<number, number>,
  positiveOnly: boolean,
): number | null {
  let sum = 0;
  let hasAny = false;
  for (const p of products) {
    if (p.nmId === null) continue;
    const v = values.get(p.nmId);
    if (v !== undefined && (!positiveOnly || v > 0)) {
      sum += v;
      hasAny = true;
    }
  }
  return hasAny ? sum : null;
}

/**
 * «Итого» по нижней строке шапки таблицы товаров. Чистая деривация из filteredProducts
 * и карт значений (та же логика, что была инлайн в DashboardCatalogProductsSection):
 * деньги/целые — сумма (выручка/с-с/реклама/сумма заказов считают только >0); buyout —
 * взвешенный %, spp — простое среднее; «нет данных» → null (рисуется «—»).
 */
export function useProductsTableTotals(input: Input): ProductsTableTotals {
  const {
    filteredProducts,
    orderCounts,
    rollingBuyoutCounts,
    stockCounts,
    ordersSumValues,
    revenueValues,
    costSumValues,
    adSpendValues,
    commissionValues,
    acquiringValues,
    drrValues,
    sppValues,
  } = input;

  const totalOrders = useMemo(
    () =>
      filteredProducts.reduce((sum, p) => {
        if (p.nmId === null) return sum;
        return sum + (orderCounts.get(p.nmId)?.ordersCount ?? 0);
      }, 0),
    [filteredProducts, orderCounts],
  );

  const totalStocks = useMemo(
    () => sumOverProducts(filteredProducts, stockCounts, false),
    [filteredProducts, stockCounts],
  );

  const totalOrdersSum = useMemo(
    () => sumOverProducts(filteredProducts, ordersSumValues, true),
    [filteredProducts, ordersSumValues],
  );

  const totalBuyoutPercent = useMemo(() => {
    let orders = 0;
    let buyouts = 0;
    for (const p of filteredProducts) {
      if (p.nmId === null) continue;
      const e = rollingBuyoutCounts.get(p.nmId);
      // Те же товары, что и в отображении: 0 выкупов = «нет данных» (—) и в «Итого»
      // не участвуют. Иначе их заказы тянули бы знаменатель вниз и итог расходился бы
      // с ретроспективой за «сегодня».
      if (!e || e.ordersCount === 0 || e.buyoutsCount === 0) continue;
      orders += e.ordersCount;
      buyouts += e.buyoutsCount;
    }
    return orders > 0 ? (buyouts / orders) * 100 : null;
  }, [filteredProducts, rollingBuyoutCounts]);

  const totalRevenue = useMemo(
    () => sumOverProducts(filteredProducts, revenueValues, true),
    [filteredProducts, revenueValues],
  );

  const totalCostSum = useMemo(
    () => sumOverProducts(filteredProducts, costSumValues, true),
    [filteredProducts, costSumValues],
  );

  const totalAdSpend = useMemo(
    () => sumOverProducts(filteredProducts, adSpendValues, true),
    [filteredProducts, adSpendValues],
  );

  const totalCommission = useMemo(
    () => sumOverProducts(filteredProducts, commissionValues, false),
    [filteredProducts, commissionValues],
  );

  const totalAcquiring = useMemo(
    () => sumOverProducts(filteredProducts, acquiringValues, false),
    [filteredProducts, acquiringValues],
  );

  const totalDrr = useMemo(
    () => sumOverProducts(filteredProducts, drrValues, false),
    [filteredProducts, drrValues],
  );

  // СПП «Итого» — простое среднее по товарам с данными (то же усреднение, что у самой
  // метрики). spp=0 — валидное значение, учитывается; «—» только без данных.
  const totalSpp = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (const p of filteredProducts) {
      if (p.nmId === null) continue;
      const v = sppValues.get(p.nmId);
      if (v !== undefined) {
        sum += v;
        count += 1;
      }
    }
    return count > 0 ? sum / count : null;
  }, [filteredProducts, sppValues]);

  return {
    totalOrders,
    totalStocks,
    totalOrdersSum,
    totalBuyoutPercent,
    totalRevenue,
    totalCostSum,
    totalAdSpend,
    totalCommission,
    totalAcquiring,
    totalDrr,
    totalSpp,
  };
}
