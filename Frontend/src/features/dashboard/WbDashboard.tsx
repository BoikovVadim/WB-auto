import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type ExportMethodStatus,
  type HealthResponse,
  type IntegrationStatusResponse,
  type SyncEntity,
  type TokenSessionResponse,
  type WbExportJobResponse,
  type WbExportListItem,
  type WbExportResponse,
} from "../../api/syncClient";
import { ui } from "./copy";
import { getSafeMessage } from "./dashboardErrors";
import type {
  ActiveSheet,
  ProductsMode,
  DashboardSection,
} from "./persistence/dashboardViewState";
import {
  formatCalendarDateValue,
  type AdvertisingDateRange,
} from "./advertising/date";
import { ProductAdvertisingWorkspacePane } from "./advertising/ProductAdvertisingWorkspacePane";
import {
  initialProductAdvertisingDetailRevisions,
  type ProductAdvertisingDetailInvalidationTarget,
  invalidateProductAdvertisingDetailRevisions,
} from "./advertising/productAdvertisingDetailInvalidation";
import {
  advertisingUxBudgetsMs,
  completeAdvertisingUxBudget,
  startAdvertisingUxBudget,
} from "./advertising/advertisingUxBudgets";
import { WbDashboardShell } from "./WbDashboardShell";
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
import { usePriceChangeStatuses } from "./usePriceChangeStatuses";
import { applyProductPrice } from "../../api/syncClientPrices";
import { useDashboardBootstrap } from "./useDashboardBootstrap";
import { useDashboardBrowserEffects } from "./useDashboardBrowserEffects";
import { useDashboardExportView } from "./useDashboardExportView";
import { useDashboardInitialState } from "./useDashboardInitialState";
import { useDashboardProductsMode } from "./useDashboardProductsMode";
import { useDashboardProductsWorkspace } from "./useDashboardProductsWorkspace";
import { useDashboardWorkspaceActions } from "./useDashboardWorkspaceActions";
import type { DashboardStatusNotice } from "./useDashboardWorkspaceActionTypes";
const primaryEntityType: SyncEntity = "product_search_texts";

function sortExportHistoryNewestFirst(items: WbExportListItem[]) {
  return [...items].sort((left, right) => {
    const leftMs = Date.parse(left.exportedAt);
    const rightMs = Date.parse(right.exportedAt);
    if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
      return rightMs - leftMs;
    }

    return right.requestId.localeCompare(left.requestId, "en");
  });
}

export function WbDashboard() {
  const {
    persistedViewState,
    cachedExportMethods,
    cachedExportHistory,
    initialSelectedMethodEntity,
    initialSelectedExportId,
    persistedCurrentExport,
    initialProductAdvertisingDateRange,
    initialSelectedProductNmId,
    initialProductsMode,
  } = useDashboardInitialState(primaryEntityType);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [integrationStatus, setIntegrationStatus] =
    useState<IntegrationStatusResponse | null>(null);
  const [tokenSession, setTokenSession] =
    useState<TokenSessionResponse | null>(null);
  const [exportMethods, setExportMethods] =
    useState<ExportMethodStatus[]>(
      cachedExportMethods.filter((method) => method.entityType === primaryEntityType),
    );
  const [exportHistory, setExportHistory] =
    useState<WbExportListItem[]>(
      sortExportHistoryNewestFirst(
        cachedExportHistory.filter((item) => item.entityType === primaryEntityType),
      ),
    );
  const [selectedMethodEntity, setSelectedMethodEntity] =
    useState<SyncEntity | null>(initialSelectedMethodEntity);
  const [activeSection, setActiveSection] = useState<DashboardSection>(
    persistedViewState.activeSection,
  );
  const [selectedExportId, setSelectedExportId] = useState<string | null>(initialSelectedExportId);
  const [currentExport, setCurrentExport] = useState<WbExportResponse | null>(
    persistedCurrentExport,
  );
  const [activeExportJob, setActiveExportJob] = useState<WbExportJobResponse | null>(null);
  const [selectedProductNmId, setSelectedProductNmId] = useState<number | null>(
    initialProductsMode === "detail" ? initialSelectedProductNmId : null,
  );
  const [selectedCatalogVendorCode, setSelectedCatalogVendorCode] = useState<string | null>(
    initialProductsMode === "detail" ? persistedViewState.selectedCatalogVendorCode : null,
  );
  const [productsMode, setProductsMode] = useState<ProductsMode>(initialProductsMode);
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<DashboardStatusNotice>(null);
  const [isDashboardBootstrapComplete, setIsDashboardBootstrapComplete] = useState(false);
  const [productAdvertisingDetailRevisions, setProductAdvertisingDetailRevisions] = useState(
    initialProductAdvertisingDetailRevisions,
  );
  const [isTokenSaving, setIsTokenSaving] = useState(false);
  const [isExportLoading, setIsExportLoading] = useState(false);
  const [isArchiveLoading, setIsArchiveLoading] = useState(false);
  const [productsSearch, setProductsSearch] = useState(persistedViewState.productsSearch);
  const [productsSortKey, setProductsSortKey] = useState<import("./useDashboardProductsWorkspace").ProductListSortKey>(persistedViewState.productsSortKey);
  const [productsSortDirection, setProductsSortDirection] = useState<"asc" | "desc">(persistedViewState.productsSortDirection);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(
    persistedViewState.activeSection === "catalog-products"
      ? persistedViewState.activeSheet
      : "none",
  );
  const isCostPriceSheetOpen = activeSection === "catalog-products" && activeSheet === "cost-price";
  const isOrdersSheetOpen    = activeSection === "catalog-products" && activeSheet === "orders";
  const isBuyoutSheetOpen    = activeSection === "catalog-products" && activeSheet === "buyout";
  const isStocksSheetOpen    = activeSection === "catalog-products" && activeSheet === "stocks";
  const isPricesSheetOpen    = activeSection === "catalog-products" && activeSheet === "prices";
  const isOrdersSumSheetOpen = activeSection === "catalog-products" && activeSheet === "orders-sum";
  const isRevenueSheetOpen   = activeSection === "catalog-products" && activeSheet === "revenue";
  const { costPrices, isCostPricesLoading, prefetchCostPrices, handleCostSaved, handleCostCleared } = useCostPrices();
  const { orderCounts } = useOrders();
  const { ordersMatrix } = useOrdersMatrix();
  const { buyoutCounts, rollingBuyoutCounts } = useBuyouts();
  const { stockCounts } = useCurrentStocks();
  const { priceCounts } = useCurrentPrices();
  const { ordersSumValues } = useOrdersSum();
  const { ordersSumMatrix } = useOrdersSumMatrix();
  const { revenueValues } = useRevenue();
  const { revenueMatrix } = useRevenueMatrix();
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
  const invalidateProductAdvertisingDetail = useCallback(
    (target: ProductAdvertisingDetailInvalidationTarget = "all") => {
      setProductAdvertisingDetailRevisions((currentValue) =>
        invalidateProductAdvertisingDetailRevisions(currentValue, target),
      );
    },
    [],
  );
  const [productAdvertisingDateRange, setProductAdvertisingDateRange] =
    useState<AdvertisingDateRange>(initialProductAdvertisingDateRange);
  const [isAdvertisingSyncStarting, setIsAdvertisingSyncStarting] = useState(false);
  const persistedAdvertisingStartDate = productAdvertisingDateRange.start
    ? formatCalendarDateValue(productAdvertisingDateRange.start)
    : null;
  const persistedAdvertisingEndDate = productAdvertisingDateRange.end
    ? formatCalendarDateValue(productAdvertisingDateRange.end)
    : null;
  const { openProductsList, openProductDetail } = useDashboardProductsMode({
    setProductsMode,
    setSelectedProductNmId,
    setSelectedCatalogVendorCode,
  });

  const { isMethodTablesReady } = useDashboardBrowserEffects({
    enablePersistence: isDashboardBootstrapComplete,
    initialScrollY: persistedViewState.scrollY ?? null,
    activeSection,
    productsMode,
    selectedMethodEntity,
    selectedExportId,
    selectedProductNmId,
    selectedCatalogVendorCode,
    persistedAdvertisingStartDate,
    persistedAdvertisingEndDate,
    currentExport,
    exportHistoryLength: exportHistory.length,
    activeSheet,
    productsSearch,
    productsSortKey,
    productsSortDirection,
    setActiveSection,
    setActiveSheet,
  });

  const currentMethod = useMemo(() => {
    return (
      exportMethods.find((method) => method.entityType === selectedMethodEntity) ?? null
    );
  }, [exportMethods, selectedMethodEntity]);

  const methodArchive = useMemo(() => {
    if (!selectedMethodEntity) {
      return [];
    }

    return exportHistory.filter((item) => item.entityType === selectedMethodEntity);
  }, [exportHistory, selectedMethodEntity]);

  const {
    displayPayload,
    currentProductExport,
    currentExportProducts,
    selectedProduct,
  } = useDashboardExportView({
    currentExport,
    primaryEntityType,
    selectedProductNmId,
  });
  const {
    productCatalogItems,
    isProductCatalogLoading,
    filteredProducts,
    resolvedCatalogProduct,
    registerCandidateProductSnapshotNmId,
    queueCandidateWarmup,
    prefetchCandidateSnapshot,
    productAdvertisingSheetRequestInput,
    productAdvertisingWorkspace,
    productAdvertisingWorkspaceError,
    isProductAdvertisingWorkspaceLoading,
  } = useDashboardProductsWorkspace({
    activeSection,
    productsMode,
    currentProductExport,
    currentExportProducts,
    productAdvertisingDateRange,
    selectedCatalogVendorCode,
    selectedProductNmId,
    productsSearch,
    productsSortKey,
    productsSortDirection,
    productAdvertisingDetailRevisions,
    setError,
    setSelectedCatalogVendorCode,
    setSelectedProductNmId,
    invalidateProductAdvertisingDetail,
    openProductsList,
  });

  const {
    openExport,
    openMethod,
    prefetchSavedExport,
    prefetchMethodLatestExport,
    openProductsWorkspace,
    prefetchProductsWorkspace,
    handleSaveToken,
    handleClearToken,
    handleRunExport,
    handleRunAdvertisingSync,
    handleReloadSelectedProductAdvertising,
    handleProductHover,
    handleProductFocus,
    handleProductOpen,
    handleBackToProducts,
    handleProductsSortToggle,
  } = useDashboardWorkspaceActions({
    primaryEntityType,
    tokenInput,
    currentExport,
    activeExportJob,
    exportHistory,
    methodArchive,
    resolvedCatalogProduct,
    productAdvertisingSheetRequestInput,
    productAdvertisingDateRange,
    openProductsList,
    openProductDetail,
    registerCandidateProductSnapshotNmId,
    queueCandidateWarmup,
    prefetchCandidateSnapshot,
    productAdvertisingDetailRevisions,
    invalidateProductAdvertisingDetail,
    setActiveSection,
    setProductsMode,
    setSelectedMethodEntity,
    setSelectedExportId,
    setCurrentExport,
    setActiveExportJob,
    setSelectedProductNmId,
    setSelectedCatalogVendorCode,
    setIsArchiveLoading,
    setError,
    setStatusNotice,
    setTokenSession,
    setTokenInput,
    setIsTokenSaving,
    setIsExportLoading,
    setIsAdvertisingSyncStarting,
    setProductAdvertisingDateRange,
    setProductsSortKey,
    setProductsSortDirection,
    setExportHistory,
    setExportMethods,
    setIntegrationStatus,
  });
  const initializeDashboard = useDashboardBootstrap({
    activeSection,
    productsMode,
    selectedMethodEntity,
    selectedExportId,
    primaryEntityType,
    setError,
    setHealth,
    setIntegrationStatus,
    setTokenSession,
    setExportMethods,
    setExportHistory,
    setSelectedMethodEntity,
    setSelectedExportId,
    setCurrentExport,
    setProductsMode,
    setSelectedProductNmId,
    openExport,
    getSafeMessage,
    backendErrorMessage: ui.backendError,
  });
  const initializeDashboardRef = useRef(initializeDashboard);

  useEffect(() => {
    initializeDashboardRef.current = initializeDashboard;
  }, [initializeDashboard]);

  useEffect(() => {
    startAdvertisingUxBudget(
      "dashboard:shell",
      "dashboard shell visible",
      advertisingUxBudgetsMs.dashboardShellVisible,
    );
    void initializeDashboardRef.current().finally(() => {
      setIsDashboardBootstrapComplete(true);
    });
  }, []);

  useEffect(() => {
    if (health !== null && integrationStatus !== null && tokenSession !== null) {
      completeAdvertisingUxBudget("dashboard:shell");
    }
  }, [health, integrationStatus, tokenSession]);

  useEffect(() => {
    completeAdvertisingUxBudget(`section:${activeSection}`);
  }, [activeSection]);

  const handleDashboardRefresh = useCallback(async () => {
    setStatusNotice(null);
    startAdvertisingUxBudget(
      "dashboard:shell",
      "dashboard shell visible",
      advertisingUxBudgetsMs.dashboardShellVisible,
    );

    if (activeSection === "products" && productsMode === "detail") {
      await handleReloadSelectedProductAdvertising({
        target: "all",
      });
    }

    await initializeDashboard();
  }, [
    activeSection,
    handleReloadSelectedProductAdvertising,
    initializeDashboard,
    productsMode,
  ]);

  

  

  

  const detailWorkspace = useMemo(
    () => (
      <ProductAdvertisingWorkspacePane
        nmId={resolvedCatalogProduct?.nmId ?? null}
        vendorCode={resolvedCatalogProduct?.vendorCode ?? ""}
        detailRevisions={productAdvertisingDetailRevisions}
        workspace={productAdvertisingWorkspace}
        dateRange={productAdvertisingDateRange}
        onDateRangeChange={setProductAdvertisingDateRange}
        loadError={productAdvertisingWorkspaceError}
        isWorkspaceLoading={isProductAdvertisingWorkspaceLoading}
        isAdvertisingSyncStarting={isAdvertisingSyncStarting}
        onRunAdvertisingSync={handleRunAdvertisingSync}
        onReloadSheet={handleReloadSelectedProductAdvertising}
      />
    ),
    [
      handleReloadSelectedProductAdvertising,
      handleRunAdvertisingSync,
      isAdvertisingSyncStarting,
      isProductAdvertisingWorkspaceLoading,
      productAdvertisingDateRange,
      productAdvertisingWorkspace,
      productAdvertisingWorkspaceError,
      productAdvertisingDetailRevisions,
      resolvedCatalogProduct,
      setProductAdvertisingDateRange,
    ],
  );

  return (
    <WbDashboardShell
      activeSection={activeSection}
      health={health}
      integrationStatus={integrationStatus}
      tokenSession={tokenSession}
      methodCards={exportMethods}
      productsMode={productsMode}
      resolvedCatalogProduct={resolvedCatalogProduct}
      productCatalogCount={productCatalogItems.length}
      productsSearch={productsSearch}
      hasCatalogItems={productCatalogItems.length > 0}
      isCatalogLoading={isProductCatalogLoading}
      filteredProducts={filteredProducts}
      productsSortKey={productsSortKey}
      productsSortDirection={productsSortDirection}
      detailWorkspace={detailWorkspace}
      currentMethod={currentMethod}
      methodArchive={methodArchive}
      selectedExportId={selectedExportId}
      selectedMethodEntity={selectedMethodEntity}
      isExportLoading={isExportLoading}
      currentExport={currentExport}
      activeExportJob={activeExportJob}
      displayPayload={displayPayload}
      isMethodTablesReady={isMethodTablesReady}
      selectedProductNmId={selectedProductNmId}
      selectedProduct={selectedProduct}
      isArchiveLoading={isArchiveLoading}
      tokenInput={tokenInput}
      isTokenSaving={isTokenSaving}
      error={error}
      statusNotice={statusNotice}
      onSetExportsSection={() => {
        setActiveSection("exports");
        setSelectedMethodEntity(null);
      }}
      onOpenJamSection={() => setActiveSection("jam")}
      onOpenCatalogSection={() => setActiveSection("catalog")}
      onOpenCampaignsSection={() => setActiveSection("campaigns")}
      onOpenSyncRunsSection={() => setActiveSection("sync-runs")}
      onOpenClusterStatsSection={() => setActiveSection("cluster-stats")}
      onOpenDailyStatsSection={() => setActiveSection("daily-stats")}
      onOpenMinusPhrasesSection={() => setActiveSection("minus-phrases")}
      onOpenQueryFrequenciesSection={() => setActiveSection("query-frequencies")}
      onOpenProductsSection={() => {
        setSelectedCatalogVendorCode(null);
        void openProductsWorkspace();
      }}
      onPrefetchProductsSection={prefetchProductsWorkspace}
      onPrefetchCatalogProductsSection={() => {
        prefetchProductsWorkspace();
        prefetchCostPrices();
      }}
      onOpenCatalogProductsSection={() => {
        prefetchProductsWorkspace();
        prefetchCostPrices();
        setActiveSheet("none");
        setActiveSection("catalog-products");
      }}
      onOpenDashboardSection={() => { setActiveSection("dashboard"); }}
      onOpenDashboardTechSection={() => { setActiveSection("dashboard-tech"); }}
      onOpenDashboardCabinetSection={() => { setActiveSection("dashboard-cabinet"); }}
      onOpenChangeHistorySection={() => { setActiveSection("change-history"); }}
      isCostPriceSheetOpen={isCostPriceSheetOpen}
      isOrdersSheetOpen={isOrdersSheetOpen}
      isBuyoutSheetOpen={isBuyoutSheetOpen}
      isStocksSheetOpen={isStocksSheetOpen}
      isPricesSheetOpen={isPricesSheetOpen}
      isOrdersSumSheetOpen={isOrdersSumSheetOpen}
      isRevenueSheetOpen={isRevenueSheetOpen}
      orderCounts={orderCounts}
      ordersMatrix={ordersMatrix}
      buyoutCounts={buyoutCounts}
      rollingBuyoutCounts={rollingBuyoutCounts}
      stockCounts={stockCounts}
      priceCounts={priceCounts}
      ordersSumValues={ordersSumValues}
      ordersSumMatrix={ordersSumMatrix}
      revenueValues={revenueValues}
      revenueMatrix={revenueMatrix}
      priceChangeStatuses={priceChangeStatuses}
      isCostPricesLoading={isCostPricesLoading}
      costPrices={costPrices}
      onOpenCostPriceSheet={() => { setActiveSheet("cost-price"); }}
      onCloseCostPriceSheet={() => { setActiveSheet("none"); }}
      onOpenOrdersSheet={() => { setActiveSection("catalog-products"); setActiveSheet("orders"); }}
      onCloseOrdersSheet={() => { setActiveSheet("none"); }}
      onOpenBuyoutSheet={() => { setActiveSection("catalog-products"); setActiveSheet("buyout"); }}
      onCloseBuyoutSheet={() => { setActiveSheet("none"); }}
      onOpenStocksSheet={() => { setActiveSection("catalog-products"); setActiveSheet("stocks"); }}
      onCloseStocksSheet={() => { setActiveSheet("none"); }}
      onOpenPricesSheet={() => { setActiveSection("catalog-products"); setActiveSheet("prices"); }}
      onClosePricesSheet={() => { setActiveSheet("none"); }}
      onOpenOrdersSumSheet={() => { setActiveSection("catalog-products"); setActiveSheet("orders-sum"); }}
      onCloseOrdersSumSheet={() => { setActiveSheet("none"); }}
      onOpenRevenueSheet={() => { setActiveSection("catalog-products"); setActiveSheet("revenue"); }}
      onCloseRevenueSheet={() => { setActiveSheet("none"); }}
      onCostSaved={handleCostSaved}
      onCostCleared={handleCostCleared}
      onPriceSaved={handlePriceSaved}
      onRefresh={() => void handleDashboardRefresh()}
      onTokenInputChange={setTokenInput}
      onSaveToken={handleSaveToken}
      onClearToken={handleClearToken}
      onOpenMethod={openMethod}
      onPrefetchMethod={prefetchMethodLatestExport}
      onProductsSearchChange={(value) => {
        startAdvertisingUxBudget(
          "products:list-search",
          "products list search or sort visible",
          advertisingUxBudgetsMs.productsSearchVisible,
        );
        setProductsSearch(value);
      }}
      onProductsSortToggle={handleProductsSortToggle}
      onProductOpen={handleProductOpen}
      onProductHover={handleProductHover}
      onProductFocus={handleProductFocus}
      onBackToProducts={handleBackToProducts}
      onBackToMethods={() => setSelectedMethodEntity(null)}
      onRunExport={handleRunExport}
      onPrefetchSavedExport={prefetchSavedExport}
      onOpenExport={openExport}
      onSelectProduct={setSelectedProductNmId}
    />
  );
}

