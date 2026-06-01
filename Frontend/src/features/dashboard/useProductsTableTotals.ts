import { useMemo } from "react";

import type { TodayOrderCount } from "../../api/syncClientOrders";
import type { CurrentPriceEntry } from "./useCurrentPrices";
import type { ProductListItem } from "./useDashboardProductsWorkspace";

export type ProductsTableTotals = {
  totalOrders: number;
  totalStocks: number | null;
  totalOrdersSum: number | null;
  totalBuyoutPercent: number | null;
  totalRevenue: number | null;
  totalCostSum: number | null;
  totalAdSpend: number | null;
  totalDrrPercent: number | null;
  totalCommission: number | null;
  totalTax: number | null;
  totalAcquiring: number | null;
  totalAcquiringPercent: number | null;
  totalDrr: number | null;
  totalMarginRub: number | null;
  totalMarginPercent: number | null;
  totalSpp: number | null;
};

type Input = {
  filteredProducts: ProductListItem[];
  orderCounts: Map<number, TodayOrderCount>;
  stockCounts: Map<number, number>;
  ordersSumValues: Map<number, number>;
  revenueValues: Map<number, number>;
  costSumValues: Map<number, number>;
  adSpendValues: Map<number, number>;
  commissionValues: Map<number, number>;
  taxValues: Map<number, number>;
  acquiringValues: Map<number, number>;
  drrValues: Map<number, number>;
  marginRubValues: Map<number, number>;
  priceCounts: Map<number, CurrentPriceEntry>;
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
 * Σвыручка / Σсумма-заказов × 100, spp — простое среднее; «нет данных» → null (рисуется «—»).
 */
export function useProductsTableTotals(input: Input): ProductsTableTotals {
  const {
    filteredProducts,
    orderCounts,
    stockCounts,
    ordersSumValues,
    revenueValues,
    costSumValues,
    adSpendValues,
    commissionValues,
    taxValues,
    acquiringValues,
    drrValues,
    marginRubValues,
    priceCounts,
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

  // «% выкупа» Итого — в деньгах: Σвыручка / Σсумма-заказов × 100 (по тем же товарам и с
  // тем же positiveOnly, что у тоталов «Выручка» и «Сумма заказов»), чтобы итог ровно
  // сходился с этими двумя соседними тоталами строки, а не считался взвешенно по штукам.
  const totalBuyoutPercent = useMemo(() => {
    let revenueSum = 0;
    let ordersSumSum = 0;
    for (const p of filteredProducts) {
      if (p.nmId === null) continue;
      const revenue = revenueValues.get(p.nmId);
      if (revenue !== undefined && revenue > 0) revenueSum += revenue;
      const ordersSum = ordersSumValues.get(p.nmId);
      if (ordersSum !== undefined && ordersSum > 0) ordersSumSum += ordersSum;
    }
    return ordersSumSum > 0 ? (revenueSum / ordersSumSum) * 100 : null;
  }, [filteredProducts, revenueValues, ordersSumValues]);

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

  // ДРР «Итого» — доля рекламы в общей выручке: Σ расход(всех рекламируемых) / Σ выручка
  // (ВСЕХ товаров) × 100, а НЕ среднее % строк. Знаменатель — полная выручка (включая
  // нерекламируемые товары), поэтому итог = «расход ÷ выручка» из колонок. Нет выручки, но
  // есть расход → 100%.
  const totalDrrPercent = useMemo(() => {
    let spendSum = 0;
    let revenueSum = 0;
    for (const p of filteredProducts) {
      if (p.nmId === null) continue;
      const spend = adSpendValues.get(p.nmId);
      if (spend !== undefined && spend > 0) spendSum += spend;
      const revenue = revenueValues.get(p.nmId);
      if (revenue !== undefined && revenue > 0) revenueSum += revenue;
    }
    if (revenueSum > 0) return (spendSum / revenueSum) * 100;
    return spendSum > 0 ? 100 : null;
  }, [filteredProducts, adSpendValues, revenueValues]);

  const totalCommission = useMemo(
    () => sumOverProducts(filteredProducts, commissionValues, false),
    [filteredProducts, commissionValues],
  );

  const totalTax = useMemo(
    () => sumOverProducts(filteredProducts, taxValues, false),
    [filteredProducts, taxValues],
  );

  const totalAcquiring = useMemo(
    () => sumOverProducts(filteredProducts, acquiringValues, false),
    [filteredProducts, acquiringValues],
  );

  // Эквайринг «Итого, %» — взвешенный: Σэквайринг₽ / Σцены-со-скидкой × 100 (по тем же
  // товарам, у кого есть эквайринг и база цены). Простое среднее % исказило бы итог
  // при разных ценах — та же логика, что у «Маржа, %».
  const totalAcquiringPercent = useMemo(() => {
    let acquiringSum = 0;
    let baseSum = 0;
    let hasAny = false;
    for (const p of filteredProducts) {
      if (p.nmId === null) continue;
      const acquiring = acquiringValues.get(p.nmId);
      const base = priceCounts.get(p.nmId)?.priceWithDiscount;
      if (acquiring !== undefined && base !== undefined && base > 0) {
        acquiringSum += acquiring;
        baseSum += base;
        hasAny = true;
      }
    }
    return hasAny && baseSum > 0 ? (acquiringSum / baseSum) * 100 : null;
  }, [filteredProducts, acquiringValues, priceCounts]);

  const totalDrr = useMemo(
    () => sumOverProducts(filteredProducts, drrValues, false),
    [filteredProducts, drrValues],
  );

  const totalMarginRub = useMemo(
    () => sumOverProducts(filteredProducts, marginRubValues, false),
    [filteredProducts, marginRubValues],
  );

  // Маржа «Итого, %» — взвешенная: Σмаржа₽ / Σцены-со-скидкой × 100 (по тем же товарам,
  // у кого есть маржа и база цены). Простое среднее % исказило бы итог при разных ценах.
  const totalMarginPercent = useMemo(() => {
    let marginSum = 0;
    let baseSum = 0;
    let hasAny = false;
    for (const p of filteredProducts) {
      if (p.nmId === null) continue;
      const margin = marginRubValues.get(p.nmId);
      const base = priceCounts.get(p.nmId)?.priceWithDiscount;
      if (margin !== undefined && base !== undefined && base > 0) {
        marginSum += margin;
        baseSum += base;
        hasAny = true;
      }
    }
    return hasAny && baseSum > 0 ? (marginSum / baseSum) * 100 : null;
  }, [filteredProducts, marginRubValues, priceCounts]);

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
    totalDrrPercent,
    totalCommission,
    totalTax,
    totalAcquiring,
    totalAcquiringPercent,
    totalDrr,
    totalMarginRub,
    totalMarginPercent,
    totalSpp,
  };
}
