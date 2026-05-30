import { DashboardCampaignsSection } from "./DashboardCampaignsSection";
import { DashboardCatalogSection } from "./DashboardCatalogSection";
import { DashboardClusterStatsSection } from "./DashboardClusterStatsSection";
import { DashboardDailyStatsSection } from "./DashboardDailyStatsSection";
import { DashboardExportsOverviewSection } from "./DashboardExportsOverviewSection";
import { DashboardJamStatusSection } from "./DashboardJamStatusSection";
import { DashboardMethodWorkspaceSection } from "./DashboardMethodWorkspaceSection";
import { DashboardMinusPhrasesSection } from "./DashboardMinusPhrasesSection";
import { DashboardCatalogProductDetailSection } from "./DashboardCatalogProductDetailSection";
import { DashboardCatalogProductsSection } from "./DashboardCatalogProductsSection";
import { DashboardOrdersDetailSection } from "./DashboardOrdersDetailSection";
import { DashboardOrdersSumDetailSection } from "./DashboardOrdersSumDetailSection";
import { DashboardRevenueDetailSection } from "./DashboardRevenueDetailSection";
import { DashboardCostSumDetailSection } from "./DashboardCostSumDetailSection";
import { DashboardAdSpendDetailSection } from "./DashboardAdSpendDetailSection";
import { DashboardSppDetailSection } from "./DashboardSppDetailSection";
import { DashboardPricesDetailSection } from "./DashboardPricesDetailSection";
import { DashboardStocksDetailSection } from "./DashboardStocksDetailSection";
import { DashboardBuyoutDetailSection } from "./DashboardBuyoutDetailSection";
import { DashboardChangeHistorySection } from "./DashboardChangeHistorySection";
import { DashboardUnitEconomicsSettingsSection } from "./DashboardUnitEconomicsSettingsSection";
import { DashboardHubSection } from "./DashboardHubSection";
import { DashboardProductsSection } from "./DashboardProductsSection";
import { DashboardQueryFrequenciesSection } from "./DashboardQueryFrequenciesSection";
import { DashboardSyncRunsSection } from "./DashboardSyncRunsSection";
import { DashboardTechSection } from "./DashboardTechSection";
import { isProductsWorkspaceSection } from "./persistence/dashboardViewState";
import { CATALOG_PRODUCTS_HIDDEN_COLUMNS, UNIT_ECONOMICS_HIDDEN_COLUMNS } from "./productsTableColumns";
import { WbCabinetSidebar } from "./WbCabinetSidebar";
import type { WbDashboardShellProps } from "./WbDashboardShellTypes";

export function WbDashboardShell({
  activeSection,
  health,
  integrationStatus,
  tokenSession,
  methodCards,
  productsMode,
  resolvedCatalogProduct,
  productCatalogCount,
  productsSearch,
  hasCatalogItems,
  isCatalogLoading,
  filteredProducts,
  productsSortKey,
  productsSortDirection,
  detailWorkspace,
  currentMethod,
  methodArchive,
  selectedExportId,
  selectedMethodEntity,
  isExportLoading,
  currentExport,
  activeExportJob,
  displayPayload,
  isMethodTablesReady,
  selectedProductNmId,
  selectedProduct,
  isArchiveLoading,
  tokenInput,
  isTokenSaving,
  error: _error,
  statusNotice,
  onSetExportsSection,
  onOpenJamSection,
  onOpenCatalogSection,
  onOpenCampaignsSection,
  onOpenSyncRunsSection,
  onOpenClusterStatsSection,
  onOpenDailyStatsSection,
  onOpenMinusPhrasesSection,
  onOpenQueryFrequenciesSection,
  onOpenProductsSection,
  onPrefetchProductsSection,
  onOpenCatalogProductsSection,
  onPrefetchCatalogProductsSection,
  onOpenUnitEconomicsSection,
  onOpenUnitEconomicsSettingsSection,
  onUnitEconomicsChargesInvalidate,
  onOpenDashboardSection,
  onOpenDashboardTechSection,
  onOpenDashboardCabinetSection,
  onOpenChangeHistorySection,
  isCostPriceSheetOpen,
  isCostPricesLoading,
  costPrices,
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
  commissionValues,
  acquiringValues,
  drrValues,
  marginRubValues,
  marginPercentValues,
  priceChangeStatuses,
  isOrdersSheetOpen,
  isBuyoutSheetOpen,
  isStocksSheetOpen,
  isPricesSheetOpen,
  isOrdersSumSheetOpen,
  isRevenueSheetOpen,
  isCostSumSheetOpen,
  isAdSpendSheetOpen,
  isSppSheetOpen,
  onOpenCostPriceSheet,
  onCloseCostPriceSheet,
  onOpenOrdersSheet,
  onCloseOrdersSheet,
  onOpenBuyoutSheet,
  onCloseBuyoutSheet,
  onOpenStocksSheet,
  onCloseStocksSheet,
  onOpenPricesSheet,
  onClosePricesSheet,
  onOpenOrdersSumSheet,
  onCloseOrdersSumSheet,
  onOpenRevenueSheet,
  onCloseRevenueSheet,
  onOpenCostSumSheet,
  onCloseCostSumSheet,
  onOpenAdSpendSheet,
  onCloseAdSpendSheet,
  onOpenSppSheet,
  onCloseSppSheet,
  onCostSaved,
  onCostCleared,
  onPriceSaved,
  onRefresh: _onRefresh,
  onTokenInputChange,
  onSaveToken,
  onClearToken,
  onOpenMethod,
  onPrefetchMethod,
  onProductsSearchChange,
  onProductsSortToggle,
  onProductOpen,
  onProductHover,
  onProductFocus,
  onBackToProducts,
  onBackToMethods,
  onRunExport,
  onPrefetchSavedExport,
  onOpenExport,
  onSelectProduct,
}: WbDashboardShellProps) {
  return (
    <div className="wb-cabinet">
      <WbCabinetSidebar
        activeSection={activeSection}
        onSetExportsSection={onSetExportsSection}
        onOpenProductsSection={onOpenProductsSection}
        onPrefetchProductsSection={onPrefetchProductsSection}
        onOpenCatalogProductsSection={onOpenCatalogProductsSection}
        onPrefetchCatalogProductsSection={onPrefetchCatalogProductsSection}
        onOpenUnitEconomicsSection={onOpenUnitEconomicsSection}
        onOpenUnitEconomicsSettingsSection={onOpenUnitEconomicsSettingsSection}
        onOpenDashboardSection={onOpenDashboardSection}
        onOpenChangeHistorySection={onOpenChangeHistorySection}
      />

      <div className="wb-cabinet-main-wrap">
        <main className="wb-cabinet-content">
          {activeSection === "jam" ? (
            <DashboardJamStatusSection onBack={onSetExportsSection} />
          ) : activeSection === "catalog" ? (
            <DashboardCatalogSection onBack={onSetExportsSection} />
          ) : activeSection === "campaigns" ? (
            <DashboardCampaignsSection onBack={onSetExportsSection} />
          ) : activeSection === "sync-runs" ? (
            <DashboardSyncRunsSection onBack={onSetExportsSection} />
          ) : activeSection === "cluster-stats" ? (
            <DashboardClusterStatsSection onBack={onSetExportsSection} />
          ) : activeSection === "daily-stats" ? (
            <DashboardDailyStatsSection onBack={onSetExportsSection} />
          ) : activeSection === "minus-phrases" ? (
            <DashboardMinusPhrasesSection onBack={onSetExportsSection} />
          ) : activeSection === "query-frequencies" ? (
            <DashboardQueryFrequenciesSection onBack={onSetExportsSection} />
          ) : activeSection === "exports" ? (
            <DashboardExportsOverviewSection
              health={health}
              integrationStatus={integrationStatus}
              tokenSession={tokenSession}
              methodCards={methodCards}
              tokenInput={tokenInput}
              isTokenSaving={isTokenSaving}
              onTokenInputChange={onTokenInputChange}
              onSaveToken={onSaveToken}
              onClearToken={onClearToken}
              onOpenMethod={onOpenMethod}
              onPrefetchMethod={onPrefetchMethod}
              onOpenJam={onOpenJamSection}
              onOpenCatalog={onOpenCatalogSection}
              onOpenCampaigns={onOpenCampaignsSection}
              onOpenSyncRuns={onOpenSyncRunsSection}
              onOpenClusterStats={onOpenClusterStatsSection}
              onOpenDailyStats={onOpenDailyStatsSection}
              onOpenMinusPhrases={onOpenMinusPhrasesSection}
              onOpenQueryFrequencies={onOpenQueryFrequenciesSection}
              onOpenOrders={onOpenOrdersSheet}
            />
          ) : isProductsWorkspaceSection(activeSection) ? (
            isCostPriceSheetOpen ? (
              <DashboardCatalogProductDetailSection
                products={filteredProducts}
                costPrices={costPrices}
                onBack={onCloseCostPriceSheet}
              />
            ) : isOrdersSheetOpen ? (
              <DashboardOrdersDetailSection
                products={filteredProducts}
                orderCounts={orderCounts}
                ordersMatrix={ordersMatrix}
                onBack={onCloseOrdersSheet}
              />
            ) : isBuyoutSheetOpen ? (
              <DashboardBuyoutDetailSection
                products={filteredProducts}
                rollingBuyoutCounts={rollingBuyoutCounts}
                onBack={onCloseBuyoutSheet}
              />
            ) : isStocksSheetOpen ? (
              <DashboardStocksDetailSection
                products={filteredProducts}
                stockCounts={stockCounts}
                onBack={onCloseStocksSheet}
              />
            ) : isPricesSheetOpen ? (
              <DashboardPricesDetailSection
                products={filteredProducts}
                priceCounts={priceCounts}
                onBack={onClosePricesSheet}
              />
            ) : isOrdersSumSheetOpen ? (
              <DashboardOrdersSumDetailSection
                products={filteredProducts}
                ordersSumValues={ordersSumValues}
                ordersSumMatrix={ordersSumMatrix}
                onBack={onCloseOrdersSumSheet}
              />
            ) : isRevenueSheetOpen ? (
              <DashboardRevenueDetailSection
                products={filteredProducts}
                revenueValues={revenueValues}
                revenueMatrix={revenueMatrix}
                onBack={onCloseRevenueSheet}
              />
            ) : isCostSumSheetOpen ? (
              <DashboardCostSumDetailSection
                products={filteredProducts}
                costSumValues={costSumValues}
                costSumMatrix={costSumMatrix}
                onBack={onCloseCostSumSheet}
              />
            ) : isAdSpendSheetOpen ? (
              <DashboardAdSpendDetailSection
                products={filteredProducts}
                adSpendValues={adSpendValues}
                adSpendMatrix={adSpendMatrix}
                onBack={onCloseAdSpendSheet}
              />
            ) : isSppSheetOpen ? (
              <DashboardSppDetailSection
                products={filteredProducts}
                sppValues={sppValues}
                sppMatrix={sppMatrix}
                onBack={onCloseSppSheet}
              />
            ) : (
              <DashboardCatalogProductsSection
                hiddenColumns={activeSection === "unit-economics" ? UNIT_ECONOMICS_HIDDEN_COLUMNS : CATALOG_PRODUCTS_HIDDEN_COLUMNS}
                productCatalogCount={productCatalogCount}
                productsSearch={productsSearch}
                hasCatalogItems={hasCatalogItems}
                isCatalogLoading={isCatalogLoading || isCostPricesLoading}
                filteredProducts={filteredProducts}
                productsSortKey={productsSortKey}
                productsSortDirection={productsSortDirection}
                costPrices={costPrices}
                orderCounts={orderCounts}
                buyoutCounts={buyoutCounts}
                rollingBuyoutCounts={rollingBuyoutCounts}
                stockCounts={stockCounts}
                priceCounts={priceCounts}
                ordersSumValues={ordersSumValues}
                revenueValues={revenueValues}
                costSumValues={costSumValues}
                adSpendValues={adSpendValues}
                sppValues={sppValues}
                commissionValues={commissionValues}
                acquiringValues={acquiringValues}
                drrValues={drrValues}
                marginRubValues={marginRubValues}
                marginPercentValues={marginPercentValues}
                priceChangeStatuses={priceChangeStatuses}
                onProductsSearchChange={onProductsSearchChange}
                onProductsSortToggle={onProductsSortToggle}
                onOpenCostPriceSheet={onOpenCostPriceSheet}
                onOpenOrdersSheet={onOpenOrdersSheet}
                onOpenBuyoutSheet={onOpenBuyoutSheet}
                onOpenStocksSheet={onOpenStocksSheet}
                onOpenPricesSheet={onOpenPricesSheet}
                onOpenOrdersSumSheet={onOpenOrdersSumSheet}
                onOpenRevenueSheet={onOpenRevenueSheet}
                onOpenCostSumSheet={onOpenCostSumSheet}
                onOpenAdSpendSheet={onOpenAdSpendSheet}
                onOpenSppSheet={onOpenSppSheet}
                onCostSaved={onCostSaved}
                onCostCleared={onCostCleared}
                onPriceSaved={onPriceSaved}
              />
            )
          ) : activeSection === "unit-economics-settings" ? (
            <DashboardUnitEconomicsSettingsSection
              onBack={onOpenUnitEconomicsSection}
              onChargesInvalidate={onUnitEconomicsChargesInvalidate}
            />
          ) : activeSection === "products" ? (
            <DashboardProductsSection
              productsMode={productsMode}
              resolvedCatalogProduct={resolvedCatalogProduct}
              productCatalogCount={productCatalogCount}
              productsSearch={productsSearch}
              hasCatalogItems={hasCatalogItems}
              isCatalogLoading={isCatalogLoading}
              filteredProducts={filteredProducts}
              productsSortKey={productsSortKey}
              productsSortDirection={productsSortDirection}
              onProductsSearchChange={onProductsSearchChange}
              onProductsSortToggle={onProductsSortToggle}
              onProductOpen={onProductOpen}
              onProductHover={onProductHover}
              onProductFocus={onProductFocus}
              onBackToProducts={onBackToProducts}
              detailWorkspace={detailWorkspace}
            />
          ) : activeSection === "dashboard" ? (
            <DashboardHubSection
              onOpenTech={onOpenDashboardTechSection}
              onOpenCabinet={onOpenDashboardCabinetSection}
            />
          ) : activeSection === "dashboard-tech" ? (
            <DashboardTechSection onBack={onOpenDashboardSection} />
          ) : activeSection === "dashboard-cabinet" ? (
            <div className="wb-card" style={{ padding: 32 }}>
              <h2>Дашборд кабинета</h2>
              <p style={{ marginTop: 12, color: "var(--wb-text-muted)" }}>В разработке.</p>
            </div>
          ) : activeSection === "change-history" ? (
            <DashboardChangeHistorySection />
          ) : (
            <DashboardMethodWorkspaceSection
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
              onBackToMethods={onBackToMethods}
              onRunExport={onRunExport}
              onPrefetchSavedExport={onPrefetchSavedExport}
              onOpenExport={onOpenExport}
              onSelectProduct={onSelectProduct}
            />
          )}

          {statusNotice ? (
            <section className={`wb-alert wb-alert--${statusNotice.tone}`}>
              {statusNotice.message}
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
