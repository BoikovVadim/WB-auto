import {
  useCallback,
  useMemo,
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
  ProductsMode,
  DashboardSection,
} from "./persistence/dashboardViewState";
import {
  formatCalendarDateValue,
  type AdvertisingDateRange,
} from "./advertising/date";
import {
  initialProductAdvertisingDetailRevisions,
  type ProductAdvertisingDetailInvalidationTarget,
  invalidateProductAdvertisingDetailRevisions,
} from "./advertising/productAdvertisingDetailInvalidation";
import { useDetailWorkspacePane } from "./useDetailWorkspacePane";
import {
  advertisingUxBudgetsMs,
  startAdvertisingUxBudget,
} from "./advertising/advertisingUxBudgets";
import { WbDashboardShell } from "./WbDashboardShell";
import { useDashboardMetrics } from "./useDashboardMetrics";
import { useDashboardBootstrap } from "./useDashboardBootstrap";
import { useDashboardBrowserEffects } from "./useDashboardBrowserEffects";
import { useDashboardExportView } from "./useDashboardExportView";
import { useDashboardInitialState } from "./useDashboardInitialState";
import { useDashboardProductsMode } from "./useDashboardProductsMode";
import { useDashboardSheets } from "./useDashboardSheets";
import { useDashboardShellHandlers } from "./useDashboardShellHandlers";
import { useDashboardLifecycle } from "./useDashboardLifecycle";
import { sortExportHistoryNewestFirst } from "./dashboardExportHistory";
import { useDashboardProductsWorkspace } from "./useDashboardProductsWorkspace";
import { useDashboardWorkspaceActions } from "./useDashboardWorkspaceActions";
import type { DashboardStatusNotice } from "./useDashboardWorkspaceActionTypes";
const primaryEntityType: SyncEntity = "product_search_texts";

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
  const {
    activeSheet,
    setActiveSheet,
    isCostPriceSheetOpen,
    isOrdersSheetOpen,
    isBuyoutSheetOpen,
    isStocksSheetOpen,
    isPricesSheetOpen,
    isOrdersSumSheetOpen,
    isRevenueSheetOpen,
    isCostSumSheetOpen,
    isAdSpendSheetOpen,
    isSppSheetOpen,
    openSheet,
    closeSheet,
  } = useDashboardSheets({
    activeSection,
    setActiveSection,
    persistedActiveSection: persistedViewState.activeSection,
    persistedActiveSheet: persistedViewState.activeSheet,
  });
  const {
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
    refreshUnitEconomicsCharges,
    priceChangeStatuses,
    handlePriceSaved,
  } = useDashboardMetrics({
    isOrdersSheetOpen,
    isOrdersSumSheetOpen,
    isRevenueSheetOpen,
    isCostSumSheetOpen,
    isAdSpendSheetOpen,
    isSppSheetOpen,
  });
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
  const { handleDashboardRefresh } = useDashboardLifecycle({
    initializeDashboard,
    health,
    integrationStatus,
    tokenSession,
    activeSection,
    productsMode,
    handleReloadSelectedProductAdvertising,
    setIsDashboardBootstrapComplete,
    setStatusNotice,
  });

  const shellHandlers = useDashboardShellHandlers({
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
  });

  const detailWorkspace = useDetailWorkspacePane({
    nmId: resolvedCatalogProduct?.nmId ?? null,
    vendorCode: resolvedCatalogProduct?.vendorCode ?? "",
    detailRevisions: productAdvertisingDetailRevisions,
    workspace: productAdvertisingWorkspace,
    dateRange: productAdvertisingDateRange,
    onDateRangeChange: setProductAdvertisingDateRange,
    loadError: productAdvertisingWorkspaceError,
    isWorkspaceLoading: isProductAdvertisingWorkspaceLoading,
    isAdvertisingSyncStarting,
    onRunAdvertisingSync: handleRunAdvertisingSync,
    onReloadSheet: handleReloadSelectedProductAdvertising,
  });

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
      {...shellHandlers}
      isCostPriceSheetOpen={isCostPriceSheetOpen}
      isOrdersSheetOpen={isOrdersSheetOpen}
      isBuyoutSheetOpen={isBuyoutSheetOpen}
      isStocksSheetOpen={isStocksSheetOpen}
      isPricesSheetOpen={isPricesSheetOpen}
      isOrdersSumSheetOpen={isOrdersSumSheetOpen}
      isRevenueSheetOpen={isRevenueSheetOpen}
      isCostSumSheetOpen={isCostSumSheetOpen}
      isAdSpendSheetOpen={isAdSpendSheetOpen}
      isSppSheetOpen={isSppSheetOpen}
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
      costSumValues={costSumValues}
      costSumMatrix={costSumMatrix}
      adSpendValues={adSpendValues}
      adSpendMatrix={adSpendMatrix}
      sppValues={sppValues}
      sppMatrix={sppMatrix}
      taxValues={taxValues}
      commissionValues={commissionValues}
      acquiringValues={acquiringValues}
      acquiringPercentValues={acquiringPercentValues}
      acquiringFactualSet={acquiringFactualSet}
      drrValues={drrValues}
      marginRubValues={marginRubValues}
      marginPercentValues={marginPercentValues}
      priceChangeStatuses={priceChangeStatuses}
      isCostPricesLoading={isCostPricesLoading}
      costPrices={costPrices}
      onCostSaved={handleCostSaved}
      onCostCleared={handleCostCleared}
      onPriceSaved={handlePriceSaved}
      onRefresh={handleDashboardRefresh}
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
      onRunExport={handleRunExport}
      onPrefetchSavedExport={prefetchSavedExport}
      onOpenExport={openExport}
      onSelectProduct={setSelectedProductNmId}
    />
  );
}

