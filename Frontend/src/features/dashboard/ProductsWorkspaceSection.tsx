import { memo, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import type { ProductAutomationStatusEntry } from "../../api/syncClientClusterAutomation";
import { useProductAutomationStatuses } from "./advertising/useProductAutomationStatuses";
import { ui } from "./copy";
import {
  loadScrollPosition,
  saveScrollPosition,
} from "./persistence/scrollPositionPersistence";
import type { ProductListItem, ProductListSortKey } from "./useDashboardProductsWorkspace";

const PRODUCT_LIST_SCROLL_KEY = "products-list";

type ProductsWorkspaceSectionProps = {
  hasCatalogItems: boolean;
  isCatalogLoading: boolean;
  productsMode: "list" | "detail";
  resolvedCatalogProduct: ProductListItem | null;
  filteredProducts: ProductListItem[];
  detailWorkspace: ReactNode;
  productsSortKey: ProductListSortKey;
  productsSortDirection: "asc" | "desc";
  onProductsSortToggle: (key: ProductListSortKey) => void;
  onProductOpen: (product: ProductListItem) => void;
  onProductHover: (nmId: number | null) => void;
  onProductFocus: (nmId: number | null) => void;
};

/** Бейдж статуса автоматизации товара для колонки «Авто». */
function renderAutomationBadge(entry: ProductAutomationStatusEntry | undefined): ReactNode {
  if (!entry || entry.mode === "off") {
    return <span style={{ color: "var(--wb-text-muted)" }}>—</span>;
  }
  const isLive = entry.mode === "live";
  const title = isLive
    ? `Автоматизация включена (live)${entry.campaignsWithAutomation > 1 ? `, кампаний: ${String(entry.campaignsWithAutomation)}` : ""}`
    : `Автоматизация в предпросмотре${entry.campaignsWithAutomation > 1 ? `, кампаний: ${String(entry.campaignsWithAutomation)}` : ""}`;
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        fontSize: "10px",
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: "6px",
        whiteSpace: "nowrap",
        background: isLive ? "#1f8a4c" : "rgba(0,0,0,0.06)",
        color: isLive ? "#fff" : "var(--wb-text-muted)",
      }}
    >
      {isLive ? "вкл" : "предпросмотр"}
    </span>
  );
}

export const ProductsWorkspaceSection = memo(function ProductsWorkspaceSection(
  props: ProductsWorkspaceSectionProps,
) {
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const resizingColRef = useRef<number | null>(null);

  // Сводный статус автоматизации по товарам — для колонки «Авто» (видно, у кого включено).
  const automationByNmId = useProductAutomationStatuses(true);

  const measureProductsHeaderMinWidth = (label: string, fallback: number) => {
    const EXTRA_SPACE = 46; // sort arrow + button gap + inner paddings + resize handle room
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return Math.max(label.length * 8 + EXTRA_SPACE, fallback);
      ctx.font = "700 12px Inter, system-ui, -apple-system, sans-serif";
      return Math.max(Math.ceil(ctx.measureText(label).width) + EXTRA_SPACE, fallback);
    } catch {
      return Math.max(label.length * 8 + EXTRA_SPACE, fallback);
    }
  };
  const nameHeaderMinWidth = useMemo(
    () => measureProductsHeaderMinWidth(ui.productNameColumn, 130),
    [],
  );
  const minResizableWidthByColumn = useMemo(
    () =>
      new Map<number, number>([
        [2, nameHeaderMinWidth],
      ]),
    [nameHeaderMinWidth],
  );

  const startColumnResize = (colIndex: number) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!tableRef.current) return;
    const tableEl = tableRef.current;
    const cols = tableEl.querySelectorAll<HTMLTableColElement>("colgroup col");
    if (!cols[colIndex]) return;

    const measuredColWidths = Array.from(cols).map((col) => {
      const measured = col.getBoundingClientRect().width;
      if (measured > 0) {
        return measured;
      }
      const parsed = Number.parseFloat(col.style.width);
      return Number.isFinite(parsed) ? parsed : 0;
    });
    const initialSelectedWidth = measuredColWidths[colIndex] ?? 0;
    const startX = event.clientX;

    resizingColRef.current = colIndex;
    document.body.style.cursor = "col-resize";

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (resizingColRef.current === null || !tableRef.current) return;
      const ths = tableEl.querySelectorAll<HTMLTableCellElement>("thead th");
      const th = ths[resizingColRef.current];
      if (!th) return;
      const minWidth = minResizableWidthByColumn.get(resizingColRef.current) ?? 48;
      const widthDelta = moveEvent.clientX - startX;
      const newWidth = Math.max(minWidth, initialSelectedWidth + widthDelta);
      th.style.width = `${newWidth}px`;

      // Sync the matching col in colgroup for table-layout:fixed
      const col = tableEl.querySelector<HTMLTableColElement>(`colgroup col:nth-child(${resizingColRef.current + 1})`);
      if (col) col.style.width = `${newWidth}px`;

      // Keep table width equal to the sum of column widths so only the resized
      // column changes size and other columns stay visually fixed.
      const totalTableWidth = measuredColWidths.reduce(
        (sum, width, index) => sum + (index === resizingColRef.current ? newWidth : width),
        0,
      );
      tableEl.style.width = `${Math.ceil(totalTableWidth)}px`;
    };

    const onMouseUp = () => {
      resizingColRef.current = null;
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp, { once: true });
  };

  // Restore scroll position when entering the list (initial mount, returning from detail,
  // or when the catalog finishes loading and the scrollable div appears in the DOM).
  // hasCatalogItems is included so the effect re-fires once the table is mounted —
  // on a hard refresh productsMode never changes, so without it the first run finds
  // tableWrapRef.current === null and the scroll is never applied.
  useLayoutEffect(() => {
    if (props.productsMode !== "list") return;
    const el = tableWrapRef.current;
    if (!el) return;
    // Prefer in-memory ref (set during the same session); fall back to sessionStorage
    // (survives page refresh).
    const target = lastScrollTopRef.current > 0
      ? lastScrollTopRef.current
      : loadScrollPosition(PRODUCT_LIST_SCROLL_KEY);
    if (target > 0) {
      el.scrollTop = target;
    }
  }, [props.productsMode, props.hasCatalogItems]);

  const getDisplayVendorCode = (p: { vendorCode: string; nmId: number | null }) =>
    p.vendorCode !== "" ? p.vendorCode : p.nmId !== null ? `#${String(p.nmId)}` : "—";

  // Measure the widest vendor code text with Canvas to lock column width.
  const widestVendorCode = useMemo(
    () =>
      props.filteredProducts.reduce((max, p) => {
        const display = getDisplayVendorCode(p);
        return display.length > max.length ? display : max;
      }, ""),
    [props.filteredProducts],
  );

  const nameColWidth = useMemo(() => {
    const MIN_WIDTH = 130;
    if (!widestVendorCode) return MIN_WIDTH;
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return Math.max(widestVendorCode.length * 9 + 22, MIN_WIDTH);
      ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
      return Math.max(Math.ceil(ctx.measureText(widestVendorCode).width) + 22, MIN_WIDTH);
    } catch {
      return Math.max(widestVendorCode.length * 9 + 22, MIN_WIDTH);
    }
  }, [widestVendorCode]);

  const campaignTotals = useMemo(
    () =>
      props.filteredProducts.reduce(
        (acc, p) => {
          if (!p.campaignCounts) return acc;
          return {
            total: acc.total + p.campaignCounts.total,
            active: acc.active + p.campaignCounts.active,
            paused: acc.paused + p.campaignCounts.paused,
            disabled: acc.disabled + p.campaignCounts.disabled,
          };
        },
        { total: 0, active: 0, paused: 0, disabled: 0 },
      ),
    [props.filteredProducts],
  );

  if (props.productsMode === "detail") {
    return <>{props.detailWorkspace}</>;
  }

  if (props.hasCatalogItems) {
    const totalW = 48 + 110 + nameColWidth + 80 + 54 + 62 + 54 + 96;
    return (
      <div className="wb-products-page">
        <section className="wb-table-section">
          <div
            ref={tableWrapRef}
            className="wb-table-wrap wb-table-wrap--products"
            onScroll={(event) => {
              const y = event.currentTarget.scrollTop;
              lastScrollTopRef.current = y;
              saveScrollPosition(PRODUCT_LIST_SCROLL_KEY, y);
            }}
          >
            <table
              ref={tableRef}
              className="wb-data-table wb-data-table--products"
              style={{ tableLayout: "fixed", width: `${String(totalW)}px` }}
            >
              <colgroup>
                <col style={{ width: "48px" }} />
                <col style={{ width: "110px" }} />
                <col style={{ width: `${String(nameColWidth)}px` }} />
                <col style={{ width: "80px" }} />
                <col style={{ width: "54px" }} />
                <col style={{ width: "62px" }} />
                <col style={{ width: "54px" }} />
                <col style={{ width: "96px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                    <button
                      className="wb-products-sort-button"
                      type="button"
                      onClick={() => props.onProductsSortToggle("id")}
                    >
                      <span>{ui.rowNumber}</span>
                      <span className={props.productsSortKey === "id" ? "wb-sort-arrow--active" : "wb-sort-arrow--inactive"}>
                        {props.productsSortKey === "id" ? (props.productsSortDirection === "asc" ? "\u2191" : "\u2193") : "\u2195"}
                      </span>
                    </button>
                  </th>
                  <th style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                    <button
                      className="wb-products-sort-button"
                      type="button"
                      onClick={() => props.onProductsSortToggle("id")}
                    >
                      <span>{ui.productIdColumn}</span>
                      <span className={props.productsSortKey === "id" ? "wb-sort-arrow--active" : "wb-sort-arrow--inactive"}>
                        {props.productsSortKey === "id" ? (props.productsSortDirection === "asc" ? "\u2191" : "\u2193") : "\u2195"}
                      </span>
                    </button>
                  </th>
                  <th style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                    <button
                      className="wb-products-sort-button"
                      type="button"
                      onClick={() => props.onProductsSortToggle("name")}
                    >
                      <span>{ui.productNameColumn}</span>
                      <span className={props.productsSortKey === "name" ? "wb-sort-arrow--active" : "wb-sort-arrow--inactive"}>
                        {props.productsSortKey === "name" ? (props.productsSortDirection === "asc" ? "\u2191" : "\u2193") : "\u2195"}
                      </span>
                    </button>
                    <div className="wb-col-resize-handle" onMouseDown={startColumnResize(2)} />
                  </th>
                  <th className="wb-table-cell--numeric wb-products-campaign-count-th" title="Всего РК" style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                    <button
                      className="wb-products-sort-button"
                      type="button"
                      onClick={() => props.onProductsSortToggle("total")}
                    >
                      <span>РК</span>
                      <span className={props.productsSortKey === "total" ? "wb-sort-arrow--active" : "wb-sort-arrow--inactive"}>
                        {props.productsSortKey === "total" ? (props.productsSortDirection === "asc" ? "\u2191" : "\u2193") : "\u2195"}
                      </span>
                    </button>
                  </th>
                  <th className="wb-table-cell--numeric wb-products-campaign-count-th wb-products-campaign-active-th" title="Включённые РК" style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                    <button
                      className="wb-products-sort-button"
                      type="button"
                      onClick={() => props.onProductsSortToggle("active")}
                    >
                      <span>Вкл</span>
                      <span className={props.productsSortKey === "active" ? "wb-sort-arrow--active" : "wb-sort-arrow--inactive"}>
                        {props.productsSortKey === "active" ? (props.productsSortDirection === "asc" ? "\u2191" : "\u2193") : "\u2195"}
                      </span>
                    </button>
                  </th>
                  <th className="wb-table-cell--numeric wb-products-campaign-count-th wb-products-campaign-paused-th" title="Приостановленные РК" style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                    <button
                      className="wb-products-sort-button"
                      type="button"
                      onClick={() => props.onProductsSortToggle("paused")}
                    >
                      <span>Пауза</span>
                      <span className={props.productsSortKey === "paused" ? "wb-sort-arrow--active" : "wb-sort-arrow--inactive"}>
                        {props.productsSortKey === "paused" ? (props.productsSortDirection === "asc" ? "\u2191" : "\u2193") : "\u2195"}
                      </span>
                    </button>
                  </th>
                  <th className="wb-table-cell--numeric wb-products-campaign-count-th wb-products-campaign-disabled-th" title="Выключенные РК" style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                    <button
                      className="wb-products-sort-button"
                      type="button"
                      onClick={() => props.onProductsSortToggle("disabled")}
                    >
                      <span>Выкл</span>
                      <span className={props.productsSortKey === "disabled" ? "wb-sort-arrow--active" : "wb-sort-arrow--inactive"}>
                        {props.productsSortKey === "disabled" ? (props.productsSortDirection === "asc" ? "\u2191" : "\u2193") : "\u2195"}
                      </span>
                    </button>
                  </th>
                  <th className="wb-table-cell--numeric" title="Автоматизация управления кластерами по CPO" style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                    Авто
                  </th>
                </tr>
                {props.filteredProducts.length > 0 ? (
                  <tr className="wb-products-totals-row wb-thead-row--second">
                    <th style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }} />
                    <th style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }} />
                    <th style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3, textAlign: "left", fontSize: "11px", fontWeight: 700, color: "rgba(15,23,42,0.45)" }}>Итого</th>
                    <th className="wb-table-cell--numeric wb-products-campaign-count-th" style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }}>
                      {campaignTotals.total > 0 ? String(campaignTotals.total) : "—"}
                    </th>
                    <th className="wb-table-cell--numeric wb-products-campaign-count-th wb-products-campaign-active-th" style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }}>
                      {campaignTotals.active > 0 ? String(campaignTotals.active) : "—"}
                    </th>
                    <th className="wb-table-cell--numeric wb-products-campaign-count-th wb-products-campaign-paused-th" style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }}>
                      {campaignTotals.paused > 0 ? String(campaignTotals.paused) : "—"}
                    </th>
                    <th className="wb-table-cell--numeric wb-products-campaign-count-th wb-products-campaign-disabled-th" style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }}>
                      {campaignTotals.disabled > 0 ? String(campaignTotals.disabled) : "—"}
                    </th>
                    <th className="wb-table-cell--numeric" style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }} />
                  </tr>
                ) : null}
              </thead>
              <tbody>
                {props.filteredProducts.length > 0 ? (
                  props.filteredProducts.map((product, index) => (
                    <tr key={`${product.vendorCode}-${product.nmId ?? "none"}`}>
                      <td className="wb-table-cell--numeric">{String(index + 1)}</td>
                      <td className="wb-table-cell--numeric">
                        {product.nmId === null ? "-" : String(product.nmId)}
                      </td>
                      <td>
                        <div className="wb-products-name-cell">
                          <button
                            className="wb-products-link"
                            type="button"
                            onMouseEnter={() => props.onProductHover(product.nmId)}
                            onPointerDown={() => props.onProductFocus(product.nmId)}
                            onFocus={() => props.onProductFocus(product.nmId)}
                            onClick={() => props.onProductOpen(product)}
                          >
                            {getDisplayVendorCode(product)}
                          </button>
                        </div>
                      </td>
                      <td className="wb-table-cell--numeric wb-products-campaign-count-td">
                        {product.campaignCounts && product.campaignCounts.total > 0 ? String(product.campaignCounts.total) : "—"}
                      </td>
                      <td className="wb-table-cell--numeric wb-products-campaign-count-td wb-products-campaign-active-td">
                        {product.campaignCounts && product.campaignCounts.active > 0 ? String(product.campaignCounts.active) : "—"}
                      </td>
                      <td className="wb-table-cell--numeric wb-products-campaign-count-td wb-products-campaign-paused-td">
                        {product.campaignCounts && product.campaignCounts.paused > 0 ? String(product.campaignCounts.paused) : "—"}
                      </td>
                      <td className="wb-table-cell--numeric wb-products-campaign-count-td wb-products-campaign-disabled-td">
                        {product.campaignCounts && product.campaignCounts.disabled > 0 ? String(product.campaignCounts.disabled) : "—"}
                      </td>
                      <td className="wb-table-cell--numeric">
                        {renderAutomationBadge(product.nmId === null ? undefined : automationByNmId[product.nmId])}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8}>{ui.noProductsFound}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  if (props.isCatalogLoading) {
    return null;
  }

  return <p className="wb-empty-copy">{ui.productsEmpty}</p>;
},
areProductsWorkspaceSectionPropsEqual);

function areProductsWorkspaceSectionPropsEqual(
  previousProps: ProductsWorkspaceSectionProps,
  nextProps: ProductsWorkspaceSectionProps,
) {
  return (
    previousProps.hasCatalogItems === nextProps.hasCatalogItems &&
    previousProps.isCatalogLoading === nextProps.isCatalogLoading &&
    previousProps.productsMode === nextProps.productsMode &&
    previousProps.productsSortKey === nextProps.productsSortKey &&
    previousProps.productsSortDirection === nextProps.productsSortDirection &&
    previousProps.filteredProducts === nextProps.filteredProducts &&
    previousProps.onProductsSortToggle === nextProps.onProductsSortToggle &&
    previousProps.onProductOpen === nextProps.onProductOpen &&
    previousProps.onProductHover === nextProps.onProductHover &&
    previousProps.onProductFocus === nextProps.onProductFocus &&
    previousProps.resolvedCatalogProduct?.vendorCode === nextProps.resolvedCatalogProduct?.vendorCode &&
    previousProps.resolvedCatalogProduct?.nmId === nextProps.resolvedCatalogProduct?.nmId &&
    (previousProps.productsMode !== "detail" ||
      previousProps.detailWorkspace === nextProps.detailWorkspace)
  );
}
