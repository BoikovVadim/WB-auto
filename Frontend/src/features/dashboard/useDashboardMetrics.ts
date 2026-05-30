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
import { usePrefetchDetailSheets } from "./usePrefetchDetailSheets";

/**
 * Бандл всех данных дашборда товаров: «сегодняшние» значения метрик (заказы, выкуп,
 * остатки, цены, суммы заказов, выручка, себестоимость продаж, расход рекламы, СПП),
 * их ретро-матрицы и хелперы записи (себестоимость, цена на WB).
 *
 * Ретро-матрицы грузятся в фоне, пока пользователь в разделе товаров (Товары/Юнит
 * Экономика) — `inProductsWorkspace`. Раньше фетч стартовал только при открытии листа,
 * и первое за день открытие ждало 1.5–8 с (orders-matrix ≈605 КБ). Теперь к моменту
 * клика данные уже в стейте/кэше → лист открывается мгновенно. На самом дашборде (вне
 * раздела товаров) матрицы по-прежнему НЕ грузятся. Освежение — интервал 30 мин,
 * пауза на скрытой вкладке; история меняется раз в сутки, поэтому staleness не важен.
 */
export function useDashboardMetrics(input: {
  isOrdersSheetOpen: boolean;
  isOrdersSumSheetOpen: boolean;
  isRevenueSheetOpen: boolean;
  isCostSumSheetOpen: boolean;
  isAdSpendSheetOpen: boolean;
  isSppSheetOpen: boolean;
  /** Активен раздел товаров (Товары/Юнит Экономика) — префетч матриц, видимых в обоих. */
  inProductsWorkspace: boolean;
  /** Активна именно секция «Товары» — там видны заказы/суммы/выручка/с-с/реклама
   *  (в «Юнит Экономике» эти колонки скрыты, их листы не открыть → не префетчим). */
  inCatalogProducts: boolean;
  /** Активна секция «Юнит Экономика» — там видны эквайринг/маржа (для префетча их листов). */
  inUnitEconomics: boolean;
}) {
  // Лист открыт ИЛИ метрика доступна в текущей секции → грузим матрицу (фоновый префетч).
  // catalog-only метрики (orders-семейство) префетчим только в «Товарах»; spp — в обеих.
  const ws = input.inProductsWorkspace;
  const cat = input.inCatalogProducts;
  // Прогрев кэша «самозагружающихся» листов (выкуп/остатки/цены/себестоимость/эквайринг/
  // маржа) — они читают кэш на маунте, поэтому прогретый кэш = мгновенное открытие.
  usePrefetchDetailSheets({
    inProductsWorkspace: ws,
    inCatalogProducts: cat,
    inUnitEconomics: input.inUnitEconomics,
  });
  const { costPrices, isCostPricesLoading, prefetchCostPrices, handleCostSaved, handleCostCleared } =
    useCostPrices();
  const { orderCounts } = useOrders();
  const { ordersMatrix } = useOrdersMatrix(input.isOrdersSheetOpen || cat);
  const { buyoutCounts, rollingBuyoutCounts } = useBuyouts();
  const { stockCounts } = useCurrentStocks();
  const { priceCounts } = useCurrentPrices();
  const { ordersSumValues } = useOrdersSum();
  const { ordersSumMatrix } = useOrdersSumMatrix(input.isOrdersSumSheetOpen || cat);
  const { revenueValues } = useRevenue();
  const { revenueMatrix } = useRevenueMatrix(input.isRevenueSheetOpen || cat);
  const { costSumValues } = useCostSum();
  const { costSumMatrix } = useCostSumMatrix(input.isCostSumSheetOpen || cat);
  const { adSpendValues } = useAdSpend();
  const { adSpendMatrix } = useAdSpendMatrix(input.isAdSpendSheetOpen || cat);
  const { sppValues } = useSpp();
  const { sppMatrix } = useSppMatrix(input.isSppSheetOpen || ws);
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
