import { ui } from "./copy";
import type { WbDashboardShellProps } from "./WbDashboardShellTypes";

type WbCabinetSidebarProps = Pick<
  WbDashboardShellProps,
  | "activeSection"
  | "onSetExportsSection"
  | "onOpenProductsSection"
  | "onPrefetchProductsSection"
  | "onOpenCatalogProductsSection"
  | "onPrefetchCatalogProductsSection"
  | "onOpenUnitEconomicsSection"
  | "onOpenDashboardSection"
  | "onOpenChangeHistorySection"
>;

export function WbCabinetSidebar({
  activeSection,
  onSetExportsSection,
  onOpenProductsSection,
  onPrefetchProductsSection,
  onOpenCatalogProductsSection,
  onPrefetchCatalogProductsSection,
  onOpenUnitEconomicsSection,
  onOpenDashboardSection,
  onOpenChangeHistorySection,
}: WbCabinetSidebarProps) {
  return (
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
          className={`wb-cabinet-menu-item ${activeSection === "unit-economics" ? "active" : ""}`}
          onMouseEnter={onPrefetchCatalogProductsSection}
          onFocus={onPrefetchCatalogProductsSection}
          onClick={onOpenUnitEconomicsSection}
        >
          <span className="wb-cabinet-menu-icon">Ю</span>
          <span className="wb-cabinet-menu-label">{ui.viewUnitEconomics}</span>
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
  );
}
