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
import { HeaderPill } from "./HeaderPill";
import { DashboardExportsOverviewSection } from "./DashboardExportsOverviewSection";
import { DashboardMethodWorkspaceSection } from "./DashboardMethodWorkspaceSection";
import { DashboardProductsSection } from "./DashboardProductsSection";
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
  onOpenProductsSection: () => void;
  onPrefetchProductsSection: () => void;
  onRefresh: () => void;
  onTokenInputChange: (value: string) => void;
  onSaveToken: () => void;
  onClearToken: () => void;
  onOpenMethod: (entityType: SyncEntity) => void;
  onPrefetchMethod: (entityType: SyncEntity) => void;
  onProductsSearchChange: (value: string) => void;
  onProductsSortToggle: () => void;
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
  error,
  statusNotice,
  onSetExportsSection,
  onOpenProductsSection,
  onPrefetchProductsSection,
  onRefresh,
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
        </nav>
      </aside>

      <div className="wb-cabinet-main-wrap">
        <main className="wb-cabinet-content">
          {activeSection === "exports" ? (
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
              productsSortDirection={productsSortDirection}
              onProductsSearchChange={onProductsSearchChange}
              onProductsSortToggle={onProductsSortToggle}
              onProductOpen={onProductOpen}
              onProductHover={onProductHover}
              onProductFocus={onProductFocus}
              onBackToProducts={onBackToProducts}
              detailWorkspace={detailWorkspace}
            />
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
