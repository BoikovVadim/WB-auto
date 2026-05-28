import type { ReactNode } from "react";

import type {
  ExportMethodStatus,
  HealthResponse,
  IntegrationStatusResponse,
  SearchQueriesExportPayload,
  SearchQueryProduct,
  SyncEntity,
  TokenSessionResponse,
  WbExportJobResponse,
  WbExportListItem,
  WbExportResponse,
} from "../../api/syncClient";
import { ui } from "./copy";
import { DashboardCampaignsSection } from "./DashboardCampaignsSection";
import { DashboardCatalogSection } from "./DashboardCatalogSection";
import { DashboardJamDailySection } from "./DashboardJamDailySection";
import { DashboardClusterStatsSection } from "./DashboardClusterStatsSection";
import { DashboardDailyStatsSection } from "./DashboardDailyStatsSection";
import { DashboardExportsOverviewSection } from "./DashboardExportsOverviewSection";
import { DashboardJamStatusSection } from "./DashboardJamStatusSection";
import { DashboardMethodWorkspaceSection } from "./DashboardMethodWorkspaceSection";
import { DashboardMinusPhrasesSection } from "./DashboardMinusPhrasesSection";
import { DashboardCatalogProductDetailSection } from "./DashboardCatalogProductDetailSection";
import { DashboardCatalogProductsSection } from "./DashboardCatalogProductsSection";
import { DashboardOrdersDetailSection } from "./DashboardOrdersDetailSection";
import { DashboardStocksDetailSection } from "./DashboardStocksDetailSection";
import { DashboardChangeHistorySection } from "./DashboardChangeHistorySection";
import { DashboardHubSection } from "./DashboardHubSection";
import { DashboardProductsSection } from "./DashboardProductsSection";
import { DashboardQueryFrequenciesSection } from "./DashboardQueryFrequenciesSection";
import { DashboardSyncRunsSection } from "./DashboardSyncRunsSection";
import { DashboardTechSection } from "./DashboardTechSection";
import type {
  DashboardProductOption,
  DashboardStatusNotice,
} from "./useDashboardWorkspaceActionTypes";
import type { DashboardSection, ProductsMode } from "./persistence/dashboardViewState";

type WbDashboardShellProps = {
  activeSection: DashboardSection;
  health: HealthResponse | null;
  integrationStatus: IntegrationStatusResponse | null;
  tokenSession: TokenSessionResponse | null;
  methodCards: ExportMethodStatus[];
  productsMode: ProductsMode;
  resolvedCatalogProduct: DashboardProductOption | null;
  productCatalogCount: number;
  productsSearch: string;
  hasCatalogItems: boolean;
  isCatalogLoading: boolean;
  filteredProducts: DashboardProductOption[];
  productsSortKey: import("./useDashboardProductsWorkspace").ProductListSortKey;
  productsSortDirection: "asc" | "desc";
  detailWorkspace: ReactNode;
  currentMethod: ExportMethodStatus | null;
  methodArchive: WbExportListItem[];
  selectedExportId: string | null;
  selectedMethodEntity: SyncEntity | null;
  isExportLoading: boolean;
  currentExport: WbExportResponse | null;
  activeExportJob: WbExportJobResponse | null;
  displayPayload: SearchQueriesExportPayload | null;
  isMethodTablesReady: boolean;
  selectedProductNmId: number | null;
  selectedProduct: SearchQueryProduct | null;
  isArchiveLoading: boolean;
  tokenInput: string;
  isTokenSaving: boolean;
  error?: string | null;
  statusNotice: DashboardStatusNotice;
  onSetExportsSection: () => void;
  onOpenJamSection: () => void;
  onOpenCatalogSection: () => void;
  onOpenCampaignsSection: () => void;
  onOpenSyncRunsSection: () => void;
  onOpenClusterStatsSection: () => void;
  onOpenDailyStatsSection: () => void;
  onOpenMinusPhrasesSection: () => void;
  onOpenQueryFrequenciesSection: () => void;
  onOpenProductsSection: () => void;
  onPrefetchProductsSection: () => void;
  onOpenCatalogProductsSection: () => void;
  onPrefetchCatalogProductsSection: () => void;
  onOpenDashboardSection: () => void;
  onOpenDashboardTechSection: () => void;
  onOpenDashboardCabinetSection: () => void;
  onOpenChangeHistorySection: () => void;
  isCostPriceSheetOpen: boolean;
  isCostPricesLoading: boolean;
  costPrices: Map<number, import("./DashboardCatalogProductsSection").CostPriceCurrent>;
  orderCounts: Map<number, import("../../api/syncClientOrders").TodayOrderCount>;
  stockCounts: Map<number, number>;
  isOrdersSheetOpen: boolean;
  isJamSheetOpen: boolean;
  isStocksSheetOpen: boolean;
  onOpenCostPriceSheet: () => void;
  onCloseCostPriceSheet: () => void;
  onOpenOrdersSheet: () => void;
  onCloseOrdersSheet: () => void;
  onOpenJamSheet: () => void;
  onCloseJamSheet: () => void;
  onOpenStocksSheet: () => void;
  onCloseStocksSheet: () => void;
  onCostSaved: (nmId: number, value: number) => Promise<void>;
  onCostCleared: (nmIds: number[]) => Promise<void>;
  onRefresh: () => void;
  onTokenInputChange: (value: string) => void;
  onSaveToken: () => void;
  onClearToken: () => void;
  onOpenMethod: (entityType: SyncEntity) => void;
  onPrefetchMethod: (entityType: SyncEntity) => void;
  onProductsSearchChange: (value: string) => void;
  onProductsSortToggle: (key: import("./useDashboardProductsWorkspace").ProductListSortKey) => void;
  onProductOpen: (product: DashboardProductOption) => void;
  onProductHover: (nmId: number | null) => void;
  onProductFocus: (nmId: number | null) => void;
  onBackToProducts: () => void;
  onBackToMethods: () => void;
  onRunExport: (entityType: SyncEntity) => void;
  onPrefetchSavedExport: (entityType: SyncEntity, exportId: string) => void;
  onOpenExport: (entityType: SyncEntity, exportId: string) => void;
  onSelectProduct: (nmId: number) => void;
};

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
  onOpenDashboardSection,
  onOpenDashboardTechSection,
  onOpenDashboardCabinetSection,
  onOpenChangeHistorySection,
  isCostPriceSheetOpen,
  isCostPricesLoading,
  costPrices,
  orderCounts,
  stockCounts,
  isOrdersSheetOpen,
  isJamSheetOpen,
  isStocksSheetOpen,
  onOpenCostPriceSheet,
  onCloseCostPriceSheet,
  onOpenOrdersSheet,
  onCloseOrdersSheet,
  onOpenJamSheet,
  onCloseJamSheet,
  onOpenStocksSheet,
  onCloseStocksSheet,
  onCostSaved,
  onCostCleared,
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
      <aside className="wb-cabinet-sidebar">
        <div className="wb-cabinet-brand">
          <div className="wb-cabinet-brand-mark">WB</div>
          <div className="wb-cabinet-brand-line" />
        </div>

        <nav className="wb-cabinet-nav">
          <button
            className={`wb-cabinet-menu-item ${activeSection === "exports" ? "active" : ""}`}
            onClick={onSetExportsSection}
          >
            <span className="wb-cabinet-menu-icon">E</span>
            <span className="wb-cabinet-menu-label">{ui.viewExports}</span>
          </button>
          <button
            className={`wb-cabinet-menu-item ${activeSection === "products" ? "active" : ""}`}
            onMouseEnter={onPrefetchProductsSection}
            onFocus={onPrefetchProductsSection}
            onClick={onOpenProductsSection}
          >
            <span className="wb-cabinet-menu-icon">P</span>
            <span className="wb-cabinet-menu-label">{ui.viewProducts}</span>
          </button>
          <button
            className={`wb-cabinet-menu-item ${activeSection === "catalog-products" ? "active" : ""}`}
            onMouseEnter={onPrefetchCatalogProductsSection}
            onFocus={onPrefetchCatalogProductsSection}
            onClick={onOpenCatalogProductsSection}
          >
            <span className="wb-cabinet-menu-icon">T</span>
            <span className="wb-cabinet-menu-label">{ui.viewCatalogProducts}</span>
          </button>
          <button
            className={`wb-cabinet-menu-item ${activeSection === "dashboard" || activeSection === "dashboard-tech" || activeSection === "dashboard-cabinet" ? "active" : ""}`}
            onClick={onOpenDashboardSection}
          >
            <span className="wb-cabinet-menu-icon">Д</span>
            <span className="wb-cabinet-menu-label">Дашборд</span>
          </button>
          <button
            className={`wb-cabinet-menu-item ${activeSection === "change-history" ? "active" : ""}`}
            onClick={onOpenChangeHistorySection}
          >
            <span className="wb-cabinet-menu-icon">И</span>
            <span className="wb-cabinet-menu-label">История</span>
          </button>
        </nav>
      </aside>

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
          ) : activeSection === "catalog-products" ? (
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
                onBack={onCloseOrdersSheet}
              />
            ) : isJamSheetOpen ? (
              <DashboardJamDailySection
                products={filteredProducts}
                onBack={onCloseJamSheet}
              />
            ) : isStocksSheetOpen ? (
              <DashboardStocksDetailSection
                products={filteredProducts}
                onBack={onCloseStocksSheet}
              />
            ) : (
              <DashboardCatalogProductsSection
                productCatalogCount={productCatalogCount}
                productsSearch={productsSearch}
                hasCatalogItems={hasCatalogItems}
                isCatalogLoading={isCatalogLoading || isCostPricesLoading}
                filteredProducts={filteredProducts}
                productsSortKey={productsSortKey}
                productsSortDirection={productsSortDirection}
                costPrices={costPrices}
                orderCounts={orderCounts}
                stockCounts={stockCounts}
                onProductsSearchChange={onProductsSearchChange}
                onProductsSortToggle={onProductsSortToggle}
                onOpenCostPriceSheet={onOpenCostPriceSheet}
                onOpenOrdersSheet={onOpenOrdersSheet}
                onOpenJamSheet={onOpenJamSheet}
                onOpenStocksSheet={onOpenStocksSheet}
                onCostSaved={onCostSaved}
                onCostCleared={onCostCleared}
              />
            )
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
