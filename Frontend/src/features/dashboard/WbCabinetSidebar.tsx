import { useEffect, useState } from "react";

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
  | "onOpenUnitEconomicsSettingsSection"
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
  onOpenUnitEconomicsSettingsSection,
  onOpenDashboardSection,
  onOpenChangeHistorySection,
}: WbCabinetSidebarProps) {
  // «Юнит Экономика» — раскрывающийся пункт с двумя вкладками (таблица / настройка).
  const isUnitEconomicsActive =
    activeSection === "unit-economics" || activeSection === "unit-economics-settings";
  const [unitEconomicsOpen, setUnitEconomicsOpen] = useState(isUnitEconomicsActive);
  // Держим подменю раскрытым, пока активна любая из вкладок (в т.ч. после перезагрузки).
  useEffect(() => {
    if (isUnitEconomicsActive) setUnitEconomicsOpen(true);
  }, [isUnitEconomicsActive]);

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

        <div className="wb-cabinet-menu-group">
          <button
            className={`wb-cabinet-menu-item ${isUnitEconomicsActive ? "active" : ""}`}
            onMouseEnter={onPrefetchCatalogProductsSection}
            onFocus={onPrefetchCatalogProductsSection}
            onClick={() => setUnitEconomicsOpen((open) => !open)}
            aria-expanded={unitEconomicsOpen}
          >
            <span className="wb-cabinet-menu-icon">Ю</span>
            <span className="wb-cabinet-menu-label">{ui.viewUnitEconomics}</span>
            <span className={`wb-cabinet-menu-chevron ${unitEconomicsOpen ? "open" : ""}`}>▾</span>
          </button>
          {unitEconomicsOpen && (
            <div className="wb-cabinet-submenu">
              <button
                className={`wb-cabinet-submenu-item ${activeSection === "unit-economics" ? "active" : ""}`}
                onClick={onOpenUnitEconomicsSection}
              >
                {ui.viewUnitEconomicsTable}
              </button>
              <button
                className={`wb-cabinet-submenu-item ${activeSection === "unit-economics-settings" ? "active" : ""}`}
                onClick={onOpenUnitEconomicsSettingsSection}
              >
                {ui.viewUnitEconomicsSettings}
              </button>
            </div>
          )}
        </div>

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
