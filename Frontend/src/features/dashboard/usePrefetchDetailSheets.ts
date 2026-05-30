import { useEffect } from "react";

import { prefetchAcquiringMatrix } from "./DashboardAcquiringDetailSection";
import { prefetchBuyoutMatrix } from "./DashboardBuyoutDetailSection";
import { prefetchCostPriceMatrix } from "./DashboardCatalogProductDetailSection";
import { prefetchMarginMatrix } from "./DashboardMarginDetailSection";
import { prefetchPricesMatrix } from "./DashboardPricesDetailSection";
import { prefetchStocksMatrix } from "./DashboardStocksDetailSection";

// История листов меняется раз в сутки (после ночных синков), поэтому 30 мин с запасом.
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Фоновый префетч ретро-листов, которые грузят данные сами при открытии (читают кэш на
 * маунте): % выкупа, остатки, цены, себестоимость, эквайринг, маржа. Пока пользователь в
 * нужной секции — прогреваем их localStorage-кэш, чтобы при клике лист открывался мгновенно
 * (компонент на маунте берёт свежий кэш из useState-инициализатора). Матрицы лёгкие (3–90 КБ),
 * грузятся параллельно в фоне и НЕ блокируют таблицу. Префетч прицельный по видимости листа
 * в секции (в «Юнит Экономике» остатков нет, в «Товарах» нет эквайринга/маржи — не тянем зря).
 *
 * Дополняет гейтинг тяжёлых матриц в useDashboardMetrics (заказы/суммы/выручка/с-с/реклама/SPP),
 * которые приходят в листы пропом. Вместе — все ретроспективы открываются сразу.
 */
export function usePrefetchDetailSheets(flags: {
  inProductsWorkspace: boolean;
  inCatalogProducts: boolean;
  inUnitEconomics: boolean;
}) {
  const { inProductsWorkspace, inCatalogProducts, inUnitEconomics } = flags;

  useEffect(() => {
    const tasks: Array<() => Promise<void>> = [];
    // Видны в обеих секциях товаров (себестоимость, цена, % выкупа).
    if (inProductsWorkspace) {
      tasks.push(prefetchCostPriceMatrix, prefetchPricesMatrix, prefetchBuyoutMatrix);
    }
    // Остатки скрыты в «Юнит Экономике» — префетчим только в «Товарах».
    if (inCatalogProducts) {
      tasks.push(prefetchStocksMatrix);
    }
    // Эквайринг/маржа скрыты в «Товарах» — префетчим только в «Юнит Экономике».
    if (inUnitEconomics) {
      tasks.push(prefetchAcquiringMatrix, prefetchMarginMatrix);
    }
    if (tasks.length === 0) return;

    const run = () => {
      for (const task of tasks) void task();
    };
    run();
    const interval = setInterval(() => {
      if (!document.hidden) run();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [inProductsWorkspace, inCatalogProducts, inUnitEconomics]);
}
