import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

import type { ActiveSheet, DashboardSection } from "./persistence/dashboardViewState";
import { isProductsWorkspaceSection } from "./persistence/dashboardViewState";

/**
 * Состояние overlay-листов рабочего стола товаров (ретроспективы метрик: заказы,
 * остатки, цены, выкуп, выручка, расход рекламы, СПП, себестоимость).
 *
 * Листы общие для секций-«рабочих столов товаров» — «Товары» (catalog-products) и
 * «Юнит Экономика» (unit-economics), поэтому флаги открытия гейтятся предикатом
 * isProductsWorkspaceSection, а не конкретной секцией. openSheet сохраняет текущую
 * секцию, если это «Юнит Экономика», иначе переключает в «Товары» (в т.ч. при заходе
 * в лист из раздела «Выгрузки»).
 */
export function useDashboardSheets(input: {
  activeSection: DashboardSection;
  setActiveSection: Dispatch<SetStateAction<DashboardSection>>;
  persistedActiveSection: DashboardSection;
  persistedActiveSheet: ActiveSheet;
}) {
  const { activeSection, setActiveSection } = input;
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(
    isProductsWorkspaceSection(input.persistedActiveSection)
      ? input.persistedActiveSheet
      : "none",
  );

  const inProductsWorkspace = isProductsWorkspaceSection(activeSection);

  const openSheet = useCallback(
    (sheet: ActiveSheet) => {
      setActiveSection((prev) => (prev === "unit-economics" ? prev : "catalog-products"));
      setActiveSheet(sheet);
    },
    [setActiveSection],
  );
  const closeSheet = useCallback(() => setActiveSheet("none"), []);

  return {
    activeSheet,
    setActiveSheet,
    isCostPriceSheetOpen: inProductsWorkspace && activeSheet === "cost-price",
    isOrdersSheetOpen: inProductsWorkspace && activeSheet === "orders",
    isBuyoutSheetOpen: inProductsWorkspace && activeSheet === "buyout",
    isStocksSheetOpen: inProductsWorkspace && activeSheet === "stocks",
    isPricesSheetOpen: inProductsWorkspace && activeSheet === "prices",
    isOrdersSumSheetOpen: inProductsWorkspace && activeSheet === "orders-sum",
    isRevenueSheetOpen: inProductsWorkspace && activeSheet === "revenue",
    isCostSumSheetOpen: inProductsWorkspace && activeSheet === "cost-sum",
    isAdSpendSheetOpen: inProductsWorkspace && activeSheet === "ad-spend",
    isSppSheetOpen: inProductsWorkspace && activeSheet === "spp",
    isAcquiringSheetOpen: inProductsWorkspace && activeSheet === "acquiring",
    openSheet,
    closeSheet,
  };
}
