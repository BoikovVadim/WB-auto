import type { SyncEntity } from "../../api/syncClient";
import type { ActiveSheet, DashboardSection } from "./persistence/dashboardViewState";

type Input = {
  setActiveSection: (section: DashboardSection) => void;
  setActiveSheet: (sheet: ActiveSheet) => void;
  setSelectedMethodEntity: (value: SyncEntity | null) => void;
  setSelectedCatalogVendorCode: (value: string | null) => void;
  openProductsWorkspace: () => void;
  prefetchProductsWorkspace: () => void;
  prefetchCostPrices: () => void;
  refreshUnitEconomicsCharges: () => void;
  openSheet: (sheet: ActiveSheet) => void;
  closeSheet: () => void;
};

/**
 * Хендлеры навигации по разделам сайдбара и открытия/закрытия ретро-листов товаров.
 * Вынесено из WbDashboard — чистая проводка к сеттерам, без своей логики; поведение
 * не меняется. Возвращаемый объект разворачивается в пропсы WbDashboardShell.
 */
export function useDashboardShellHandlers(input: Input) {
  const {
    setActiveSection,
    setActiveSheet,
    setSelectedMethodEntity,
    setSelectedCatalogVendorCode,
    openProductsWorkspace,
    prefetchProductsWorkspace,
    prefetchCostPrices,
    refreshUnitEconomicsCharges,
    openSheet,
    closeSheet,
  } = input;

  const openProductsWorkspaceSection = (section: "catalog-products" | "unit-economics") => {
    prefetchProductsWorkspace();
    prefetchCostPrices();
    setActiveSheet("none");
    setActiveSection(section);
  };

  return {
    onSetExportsSection: () => {
      setActiveSection("exports");
      setSelectedMethodEntity(null);
    },
    onOpenJamSection: () => setActiveSection("jam"),
    onOpenCatalogSection: () => setActiveSection("catalog"),
    onOpenCampaignsSection: () => setActiveSection("campaigns"),
    onOpenSyncRunsSection: () => setActiveSection("sync-runs"),
    onOpenClusterStatsSection: () => setActiveSection("cluster-stats"),
    onOpenDailyStatsSection: () => setActiveSection("daily-stats"),
    onOpenMinusPhrasesSection: () => setActiveSection("minus-phrases"),
    onOpenQueryFrequenciesSection: () => setActiveSection("query-frequencies"),
    onOpenProductsSection: () => {
      setSelectedCatalogVendorCode(null);
      openProductsWorkspace();
    },
    onPrefetchProductsSection: prefetchProductsWorkspace,
    onPrefetchCatalogProductsSection: () => {
      prefetchProductsWorkspace();
      prefetchCostPrices();
    },
    onOpenCatalogProductsSection: () => openProductsWorkspaceSection("catalog-products"),
    onOpenUnitEconomicsSection: () => openProductsWorkspaceSection("unit-economics"),
    onOpenUnitEconomicsSettingsSection: () => {
      setActiveSheet("none");
      setActiveSection("unit-economics-settings");
    },
    onUnitEconomicsChargesInvalidate: refreshUnitEconomicsCharges,
    onOpenDashboardSection: () => setActiveSection("dashboard"),
    onOpenDashboardTechSection: () => setActiveSection("dashboard-tech"),
    onOpenDashboardCabinetSection: () => setActiveSection("dashboard-cabinet"),
    onOpenChangeHistorySection: () => setActiveSection("change-history"),
    onBackToMethods: () => setSelectedMethodEntity(null),
    // Ретро-листы метрик товаров.
    onOpenCostPriceSheet: () => openSheet("cost-price"),
    onCloseCostPriceSheet: closeSheet,
    onOpenOrdersSheet: () => openSheet("orders"),
    onCloseOrdersSheet: closeSheet,
    onOpenBuyoutSheet: () => openSheet("buyout"),
    onCloseBuyoutSheet: closeSheet,
    onOpenStocksSheet: () => openSheet("stocks"),
    onCloseStocksSheet: closeSheet,
    onOpenPricesSheet: () => openSheet("prices"),
    onClosePricesSheet: closeSheet,
    onOpenOrdersSumSheet: () => openSheet("orders-sum"),
    onCloseOrdersSumSheet: closeSheet,
    onOpenRevenueSheet: () => openSheet("revenue"),
    onCloseRevenueSheet: closeSheet,
    onOpenCostSumSheet: () => openSheet("cost-sum"),
    onCloseCostSumSheet: closeSheet,
    onOpenAdSpendSheet: () => openSheet("ad-spend"),
    onCloseAdSpendSheet: closeSheet,
    onOpenDrrPercentSheet: () => openSheet("drr-percent"),
    onCloseDrrPercentSheet: closeSheet,
    onOpenSppSheet: () => openSheet("spp"),
    onCloseSppSheet: closeSheet,
    onOpenAcquiringSheet: () => openSheet("acquiring"),
    onCloseAcquiringSheet: closeSheet,
    onOpenMarginRubSheet: () => openSheet("margin-rub"),
    onCloseMarginRubSheet: closeSheet,
    onOpenMarginPercentSheet: () => openSheet("margin-percent"),
    onCloseMarginPercentSheet: closeSheet,
  };
}
