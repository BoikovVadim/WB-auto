import { Suspense } from "react";

// Eager: главная таблица товаров/юнит-экономики (самый частый дефолтный экран, prefetch на
// hover уже есть) + лёгкие Hub/Tech. Их держим в основном бандле, чтобы первый экран не ждал
// отдельный чанк.
import { DashboardCatalogProductsSection } from "./DashboardCatalogProductsSection";
import { DashboardHubSection } from "./DashboardHubSection";
import { DashboardTechSection } from "./DashboardTechSection";
import { isProductsWorkspaceSection } from "./persistence/dashboardViewState";

// Lazy-секции (отдельные чанки) + SectionFallback — реестр в WbDashboardLazySections.
import {
  DashboardProductsSection,
  DashboardCampaignsSection,
  DashboardCatalogSection,
  DashboardClusterStatsSection,
  DashboardDailyStatsSection,
  DashboardExportsOverviewSection,
  DashboardJamStatusSection,
  DashboardMethodWorkspaceSection,
  DashboardMinusPhrasesSection,
  DashboardCatalogProductDetailSection,
  DashboardOrdersDetailSection,
  DashboardOrdersSumDetailSection,
  DashboardRevenueDetailSection,
  DashboardCostSumDetailSection,
  DashboardAdSpendDetailSection,
  DashboardDrrPercentDetailSection,
  DashboardCpoDetailSection,
  DashboardSppDetailSection,
  DashboardAcquiringDetailSection,
  DashboardMarginDetailSection,
  DashboardPricesDetailSection,
  DashboardStocksDetailSection,
  DashboardBuyoutDetailSection,
  DashboardChangeHistorySection,
  DashboardUnitEconomicsSettingsSection,
  DashboardQueryFrequenciesSection,
  DashboardSyncRunsSection,
  SectionFallback,
} from "./WbDashboardLazySections";
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
  onPrefetchUnitEconomicsSettingsSection,
  onOpenUnitEconomicsSettingsSection,
  onUnitEconomicsChargesInvalidate,
  onOpenDashboardSection,
  onOpenDashboardTechSection,
  onOpenDashboardCabinetSection,
  onPrefetchChangeHistorySection,
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
  drrPercentValues,
  drrMatrix,
  cpoValues,
  cpoMatrix,
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
  priceChangeStatuses,
  isOrdersSheetOpen,
  isBuyoutSheetOpen,
  isStocksSheetOpen,
  isPricesSheetOpen,
  isOrdersSumSheetOpen,
  isRevenueSheetOpen,
  isCostSumSheetOpen,
  isAdSpendSheetOpen,
  isDrrPercentSheetOpen,
  isCpoSheetOpen,
  isSppSheetOpen,
  isAcquiringSheetOpen,
  isMarginRubSheetOpen,
  isMarginPercentSheetOpen,
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
  onOpenDrrPercentSheet,
  onCloseDrrPercentSheet,
  onOpenCpoSheet,
  onCloseCpoSheet,
  onOpenSppSheet,
  onCloseSppSheet,
  onOpenAcquiringSheet,
  onCloseAcquiringSheet,
  onOpenMarginRubSheet,
  onCloseMarginRubSheet,
  onOpenMarginPercentSheet,
  onCloseMarginPercentSheet,
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
        onPrefetchUnitEconomicsSettingsSection={onPrefetchUnitEconomicsSettingsSection}
        onOpenUnitEconomicsSettingsSection={onOpenUnitEconomicsSettingsSection}
        onOpenDashboardSection={onOpenDashboardSection}
        onPrefetchChangeHistorySection={onPrefetchChangeHistorySection}
        onOpenChangeHistorySection={onOpenChangeHistorySection}
      />

      <div className="wb-cabinet-main-wrap">
        <main className="wb-cabinet-content">
          <Suspense fallback={<SectionFallback />}>
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
            ) : isDrrPercentSheetOpen ? (
              <DashboardDrrPercentDetailSection
                products={filteredProducts}
                drrPercentValues={drrPercentValues}
                adSpendValues={adSpendValues}
                revenueValues={revenueValues}
                drrMatrix={drrMatrix}
                onBack={onCloseDrrPercentSheet}
              />
            ) : isCpoSheetOpen ? (
              <DashboardCpoDetailSection
                products={filteredProducts}
                cpoValues={cpoValues}
                orderCounts={orderCounts}
                cpoMatrix={cpoMatrix}
                onBack={onCloseCpoSheet}
              />
            ) : isSppSheetOpen ? (
              <DashboardSppDetailSection
                products={filteredProducts}
                sppValues={sppValues}
                sppMatrix={sppMatrix}
                onBack={onCloseSppSheet}
              />
            ) : isAcquiringSheetOpen ? (
              <DashboardAcquiringDetailSection
                products={filteredProducts}
                onBack={onCloseAcquiringSheet}
              />
            ) : isMarginRubSheetOpen ? (
              <DashboardMarginDetailSection
                products={filteredProducts}
                mode="rub"
                onBack={onCloseMarginRubSheet}
              />
            ) : isMarginPercentSheetOpen ? (
              <DashboardMarginDetailSection
                products={filteredProducts}
                mode="percent"
                onBack={onCloseMarginPercentSheet}
              />
            ) : (
              <DashboardCatalogProductsSection
                hiddenColumns={activeSection === "unit-economics" ? UNIT_ECONOMICS_HIDDEN_COLUMNS : CATALOG_PRODUCTS_HIDDEN_COLUMNS}
                editable={activeSection === "unit-economics"}
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
                drrPercentValues={drrPercentValues}
                cpoValues={cpoValues}
                sppValues={sppValues}
                taxValues={taxValues}
                commissionValues={commissionValues}
                acquiringValues={acquiringValues}
                acquiringPercentValues={acquiringPercentValues}
                acquiringFactualSet={acquiringFactualSet}
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
                onOpenDrrPercentSheet={onOpenDrrPercentSheet}
                onOpenCpoSheet={onOpenCpoSheet}
                onOpenSppSheet={onOpenSppSheet}
                onOpenAcquiringSheet={onOpenAcquiringSheet}
                onOpenMarginRubSheet={onOpenMarginRubSheet}
                onOpenMarginPercentSheet={onOpenMarginPercentSheet}
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
          </Suspense>

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
