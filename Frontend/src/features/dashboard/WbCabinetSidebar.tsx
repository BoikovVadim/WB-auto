import { useEffect, useRef, useState } from "react";

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
  // «Юнит Экономика» открывает всплывающий столбик-поповер (не модалка) с двумя
  // вкладками. Поповер позиционируем fixed по координатам кнопки — сайдбар с
  // overflow-y:auto обрезал бы обычный absolute.
  const isUnitEconomicsActive =
    activeSection === "unit-economics" || activeSection === "unit-economics-settings";
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const isFlyoutOpen = flyoutPos !== null;

  const closeFlyout = () => setFlyoutPos(null);
  const toggleFlyout = () => {
    if (isFlyoutOpen) {
      closeFlyout();
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setFlyoutPos({ top: rect.top, left: rect.right + 8 });
  };

  useEffect(() => {
    if (!isFlyoutOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || flyoutRef.current?.contains(target)) return;
      closeFlyout();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeFlyout();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isFlyoutOpen]);

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
          ref={buttonRef}
          className={`wb-cabinet-menu-item ${isUnitEconomicsActive || isFlyoutOpen ? "active" : ""}`}
          onMouseEnter={onPrefetchCatalogProductsSection}
          onFocus={onPrefetchCatalogProductsSection}
          onClick={toggleFlyout}
          aria-expanded={isFlyoutOpen}
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

      {flyoutPos && (
        <div
          ref={flyoutRef}
          className="wb-cabinet-flyout"
          style={{ top: flyoutPos.top, left: flyoutPos.left }}
          role="menu"
        >
          <span className="wb-cabinet-flyout-title">{ui.viewUnitEconomics}</span>
          <button
            className={`wb-cabinet-flyout-item ${activeSection === "unit-economics" ? "active" : ""}`}
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenUnitEconomicsSection();
              closeFlyout();
            }}
          >
            {ui.viewUnitEconomicsTable}
          </button>
          <button
            className={`wb-cabinet-flyout-item ${activeSection === "unit-economics-settings" ? "active" : ""}`}
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenUnitEconomicsSettingsSection();
              closeFlyout();
            }}
          >
            {ui.viewUnitEconomicsSettings}
          </button>
        </div>
      )}
    </aside>
  );
}
