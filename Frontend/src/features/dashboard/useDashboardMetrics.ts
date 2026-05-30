import { useCallback } from "react";

import { applyProductPrice } from "../../api/syncClientPrices";
import { useCostPrices } from "./useCostPrices";
import { useOrders } from "./useOrders";
import { useOrdersMatrix } from "./useOrdersMatrix";
import { useBuyouts } from "./useBuyouts";
import { useCurrentStocks } from "./useCurrentStocks";
import { useCurrentPrices } from "./useCurrentPrices";
import { useOrdersSum } from "./useOrdersSum";
import { useOrdersSumMatrix } from "./useOrdersSumMatrix";
import { useRevenue } from "./useRevenue";
import { useRevenueMatrix } from "./useRevenueMatrix";
import { useCostSum } from "./useCostSum";
import { useCostSumMatrix } from "./useCostSumMatrix";
import { useAdSpend } from "./useAdSpend";
import { useAdSpendMatrix } from "./useAdSpendMatrix";
import { useSpp } from "./useSpp";
import { useSppMatrix } from "./useSppMatrix";
import { useUnitEconomicsCharges } from "./useUnitEconomicsCharges";
import { usePriceChangeStatuses } from "./usePriceChangeStatuses";

/**
 * Бандл всех данных дашборда товаров: «сегодняшние» значения метрик (заказы, выкуп,
 * остатки, цены, суммы заказов, выручка, себестоимость продаж, расход рекламы, СПП),
 * их ретро-матрицы и хелперы записи (себестоимость, цена на WB).
 *
 * Тяжёлые ретро-матрицы грузятся ЛЕНИВО — только когда открыт соответствующий лист
 * (флаги передаются из useDashboardSheets), а не на маунте дашборда.
 */
export function useDashboardMetrics(input: {
  isOrdersSheetOpen: boolean;
  isOrdersSumSheetOpen: boolean;
  isRevenueSheetOpen: boolean;
  isCostSumSheetOpen: boolean;
  isAdSpendSheetOpen: boolean;
  isSppSheetOpen: boolean;
}) {
  const { costPrices, isCostPricesLoading, prefetchCostPrices, handleCostSaved, handleCostCleared } =
    useCostPrices();
  const { orderCounts } = useOrders();
  const { ordersMatrix } = useOrdersMatrix(input.isOrdersSheetOpen);
  const { buyoutCounts, rollingBuyoutCounts } = useBuyouts();
  const { stockCounts } = useCurrentStocks();
  const { priceCounts } = useCurrentPrices();
  const { ordersSumValues } = useOrdersSum();
  const { ordersSumMatrix } = useOrdersSumMatrix(input.isOrdersSumSheetOpen);
  const { revenueValues } = useRevenue();
  const { revenueMatrix } = useRevenueMatrix(input.isRevenueSheetOpen);
  const { costSumValues } = useCostSum();
  const { costSumMatrix } = useCostSumMatrix(input.isCostSumSheetOpen);
  const { adSpendValues } = useAdSpend();
  const { adSpendMatrix } = useAdSpendMatrix(input.isAdSpendSheetOpen);
  const { sppValues } = useSpp();
  const { sppMatrix } = useSppMatrix(input.isSppSheetOpen);
  const {
    taxValues,
    commissionValues,
    acquiringValues,
    acquiringPercentValues,
    acquiringFactualSet,
    drrValues,
    marginRubValues,
    marginPercentValues,
    refreshCharges,
  } = useUnitEconomicsCharges();
  const { priceChangeStatuses, refreshPriceChangeStatuses, upsertPriceChangeStatus } =
    usePriceChangeStatuses();

  const handlePriceSaved = useCallback(
    async (nmId: number, targetFinal: number) => {
      // ⚠️ Реальная запись цены на маркетплейс WB. Дёргается только из ячейки «Цена».
      const res = await applyProductPrice(nmId, targetFinal);
      if (res.status !== "noop") {
        // Оптимистично фиксируем новую цену в таблице сразу (до подтверждения WB).
        // reconcile-крон позже скорректирует observedFinal на реальную кабинетную.
        upsertPriceChangeStatus({
          nmId: res.nmId,
          desiredBasePrice: res.desiredBasePrice,
          desiredDiscount: res.desiredDiscount,
          desiredFinal: res.desiredFinal,
          syncStatus: res.status === "failed" ? "failed" : "sending",
          uploadId: null,
          observedFinal: res.status === "failed" ? res.currentFinal : null,
          confirmedAt: null,
          retryAt: null,
          lastError: res.lastError,
          attemptCount: 0,
          updatedAt: new Date().toISOString(),
        });
      }
      refreshPriceChangeStatuses();
    },
    [refreshPriceChangeStatuses, upsertPriceChangeStatus],
  );

  return {
    costPrices,
    isCostPricesLoading,
    prefetchCostPrices,
    handleCostSaved,
    handleCostCleared,
    orderCounts,
    ordersMatrix,
    buyoutCounts,
    rollingBuyoutCounts,
    stockCounts,
    priceCounts,
    ordersSumValues,
    ordersSumMatrix,
    revenueValues,
    revenueMatrix,
    costSumValues,
    costSumMatrix,
    adSpendValues,
    adSpendMatrix,
    sppValues,
    sppMatrix,
    taxValues,
    commissionValues,
    acquiringValues,
    acquiringPercentValues,
    acquiringFactualSet,
    drrValues,
    marginRubValues,
    marginPercentValues,
    refreshUnitEconomicsCharges: refreshCharges,
    priceChangeStatuses,
    handlePriceSaved,
  };
}
