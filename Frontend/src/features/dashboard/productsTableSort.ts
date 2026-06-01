import type { CostPriceCurrent } from "../../api/syncClientCostPrice";
import type { TodayBuyoutCount } from "../../api/syncClientBuyouts";
import type { TodayOrderCount } from "../../api/syncClientOrders";
import type { CurrentPriceEntry } from "./useCurrentPrices";
import type { ProductListItem } from "./useDashboardProductsWorkspace";

// Колонки, у которых сортировка локальная (значения берутся из внешних Map, а не из
// parent-сортировки списка товаров).
export type LocalSortKey =
  | "cost"
  | "price"
  | "commission"
  | "tax"
  | "acquiring"
  | "acquiringPercent"
  | "drr"
  | "marginRub"
  | "marginPercent"
  | "priceForMargin"
  | "marginForPrice"
  | "orders"
  | "buyout"
  | "spp"
  | "stock"
  | "ordersSum"
  | "revenue"
  | "costSum"
  | "adSpend"
  | "drrPercent"
  | "cpo";

type SortMaps = {
  costPrices: Map<number, CostPriceCurrent>;
  orderCounts: Map<number, TodayOrderCount>;
  rollingBuyoutCounts: Map<number, TodayBuyoutCount>;
  stockCounts: Map<number, number>;
  priceCounts: Map<number, CurrentPriceEntry>;
  ordersSumValues: Map<number, number>;
  revenueValues: Map<number, number>;
  costSumValues: Map<number, number>;
  adSpendValues: Map<number, number>;
  drrPercentValues: Map<number, number>;
  cpoValues: Map<number, number>;
  sppValues: Map<number, number>;
  commissionValues: Map<number, number>;
  taxValues: Map<number, number>;
  acquiringValues: Map<number, number>;
  acquiringPercentValues: Map<number, number>;
  drrValues: Map<number, number>;
  marginRubValues: Map<number, number>;
  marginPercentValues: Map<number, number>;
  priceForMarginValues: Map<number, number | null>;
  marginForPriceValues: Map<number, number | null>;
};

// Числовое значение товара для локальной сортировки. «Нет данных» для buyout/spp/
// commission/tax/acquiring/drr = -1 (валидный 0 сортируется выше отсутствующего); для маржи
// = -Infinity (она бывает отрицательной, -1 был бы валидным значением); для остальных — 0.
function localSortValue(product: ProductListItem, key: LocalSortKey, maps: SortMaps): number {
  const nmId = product.nmId;
  if (nmId === null) {
    if (key === "marginRub" || key === "marginPercent" || key === "priceForMargin" || key === "marginForPrice")
      return Number.NEGATIVE_INFINITY;
    return key === "buyout" || key === "spp" || key === "commission" || key === "tax" || key === "acquiring" || key === "acquiringPercent" || key === "drr" || key === "drrPercent" || key === "cpo"
      ? -1
      : 0;
  }
  switch (key) {
    case "orders":
      return maps.orderCounts.get(nmId)?.ordersCount ?? 0;
    case "buyout": {
      const entry = maps.rollingBuyoutCounts.get(nmId);
      // 0 выкупов при наличии заказов = данных ещё нет (WB отдаёт выкупы с лагом), а не
      // реальный 0 % — сортируем как «нет данных».
      if (!entry || entry.ordersCount === 0 || entry.buyoutsCount === 0) return -1;
      return (entry.buyoutsCount / entry.ordersCount) * 100;
    }
    case "stock":
      return maps.stockCounts.get(nmId) ?? 0;
    case "ordersSum":
      return maps.ordersSumValues.get(nmId) ?? 0;
    case "revenue":
      return maps.revenueValues.get(nmId) ?? 0;
    case "costSum":
      return maps.costSumValues.get(nmId) ?? 0;
    case "adSpend":
      return maps.adSpendValues.get(nmId) ?? 0;
    case "drrPercent":
      return maps.drrPercentValues.get(nmId) ?? -1;
    case "cpo":
      return maps.cpoValues.get(nmId) ?? -1;
    case "commission":
      return maps.commissionValues.get(nmId) ?? -1;
    case "tax":
      return maps.taxValues.get(nmId) ?? -1;
    case "acquiring":
      return maps.acquiringValues.get(nmId) ?? -1;
    case "acquiringPercent":
      return maps.acquiringPercentValues.get(nmId) ?? -1;
    case "drr":
      return maps.drrValues.get(nmId) ?? -1;
    case "marginRub":
      return maps.marginRubValues.get(nmId) ?? Number.NEGATIVE_INFINITY;
    case "marginPercent":
      return maps.marginPercentValues.get(nmId) ?? Number.NEGATIVE_INFINITY;
    case "priceForMargin":
      return maps.priceForMarginValues.get(nmId) ?? Number.NEGATIVE_INFINITY;
    case "marginForPrice":
      return maps.marginForPriceValues.get(nmId) ?? Number.NEGATIVE_INFINITY;
    case "spp":
      return maps.sppValues.get(nmId) ?? -1;
    case "price":
      return maps.priceCounts.get(nmId)?.priceWithDiscount ?? 0;
    case "cost":
      return maps.costPrices.get(nmId)?.costValue ?? 0;
  }
}

/**
 * Товары, отсортированные локально по колонке-метрике. При localSortKey === null
 * возвращает исходный (parent-сортированный) список без копирования.
 */
export function sortProductsByLocalKey(
  products: ProductListItem[],
  localSortKey: LocalSortKey | null,
  localSortDir: "asc" | "desc",
  maps: SortMaps,
): ProductListItem[] {
  if (!localSortKey) return products;
  return [...products].sort((a, b) => {
    const av = localSortValue(a, localSortKey, maps);
    const bv = localSortValue(b, localSortKey, maps);
    return localSortDir === "asc" ? av - bv : bv - av;
  });
}
