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
import { useCurrentStocks } from "./useCurrentStocks";
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
  const isJamSheetOpen       = activeSection === "catalog-products" && activeSheet === "jam";
  const isStocksSheetOpen    = activeSection === "catalog-products" && activeSheet === "stocks";
  const { costPrices, isCostPricesLoading, prefetchCostPrices, handleCostSaved, handleCostCleared } = useCostPrices();
  const { orderCounts } = useOrders();
  const { stockCounts } = useCurrentStocks();
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
      isJamSheetOpen={isJamSheetOpen}
      isStocksSheetOpen={isStocksSheetOpen}
      orderCounts={orderCounts}
      stockCounts={stockCounts}
      isCostPricesLoading={isCostPricesLoading}
      costPrices={costPrices}
      onOpenCostPriceSheet={() => { setActiveSheet("cost-price"); }}
      onCloseCostPriceSheet={() => { setActiveSheet("none"); }}
      onOpenOrdersSheet={() => { setActiveSection("catalog-products"); setActiveSheet("orders"); }}
      onCloseOrdersSheet={() => { setActiveSheet("none"); }}
      onOpenJamSheet={() => { setActiveSection("catalog-products"); setActiveSheet("jam"); }}
      onCloseJamSheet={() => { setActiveSheet("none"); }}
      onOpenStocksSheet={() => { setActiveSection("catalog-products"); setActiveSheet("stocks"); }}
      onCloseStocksSheet={() => { setActiveSheet("none"); }}
      onCostSaved={handleCostSaved}
      onCostCleared={handleCostCleared}
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

