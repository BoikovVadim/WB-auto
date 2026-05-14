import { memo, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import { ui } from "./copy";
import {
  loadScrollPosition,
  saveScrollPosition,
} from "./persistence/scrollPositionPersistence";
import type { ProductListSortKey } from "./useDashboardProductsWorkspace";

const PRODUCT_LIST_SCROLL_KEY = "products-list";

type ProductListItem = {
  vendorCode: string;
  nmId: number | null;
  campaignCounts?: { total: number; active: number; paused: number; disabled: number };
};

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

export const ProductsWorkspaceSection = memo(function ProductsWorkspaceSection(
  props: ProductsWorkspaceSectionProps,
) {
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTopRef = useRef(0);

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
    const totalW = 48 + 110 + nameColWidth + 80 + 54 + 62 + 54;
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
              </colgroup>
              <thead>
                <tr>
                  <th>{ui.rowNumber}</th>
                  <th>{ui.productIdColumn}</th>
                  <th>
                    <button
                      className="wb-products-sort-button"
                      type="button"
                      onClick={() => props.onProductsSortToggle("name")}
                    >
                      <span>{ui.productNameColumn}</span>
                      {props.productsSortKey === "name" && (
                        <span>{props.productsSortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                      )}
                    </button>
                  </th>
                  <th className="wb-table-cell--numeric wb-products-campaign-count-th" title="Всего РК">
                    <button
                      className="wb-products-sort-button"
                      type="button"
                      onClick={() => props.onProductsSortToggle("total")}
                    >
                      <span>РК</span>
                      {props.productsSortKey === "total" && (
                        <span>{props.productsSortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                      )}
                    </button>
                  </th>
                  <th className="wb-table-cell--numeric wb-products-campaign-count-th wb-products-campaign-active-th" title="Включённые РК">
                    <button
                      className="wb-products-sort-button"
                      type="button"
                      onClick={() => props.onProductsSortToggle("active")}
                    >
                      <span>Вкл</span>
                      {props.productsSortKey === "active" && (
                        <span>{props.productsSortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                      )}
                    </button>
                  </th>
                  <th className="wb-table-cell--numeric wb-products-campaign-count-th wb-products-campaign-paused-th" title="Приостановленные РК">
                    <button
                      className="wb-products-sort-button"
                      type="button"
                      onClick={() => props.onProductsSortToggle("paused")}
                    >
                      <span>Пауза</span>
                      {props.productsSortKey === "paused" && (
                        <span>{props.productsSortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                      )}
                    </button>
                  </th>
                  <th className="wb-table-cell--numeric wb-products-campaign-count-th wb-products-campaign-disabled-th" title="Выключенные РК">
                    <button
                      className="wb-products-sort-button"
                      type="button"
                      onClick={() => props.onProductsSortToggle("disabled")}
                    >
                      <span>Выкл</span>
                      {props.productsSortKey === "disabled" && (
                        <span>{props.productsSortDirection === "asc" ? "\u2191" : "\u2193"}</span>
                      )}
                    </button>
                  </th>
                </tr>
                {props.filteredProducts.length > 0 ? (
                  <tr className="wb-products-totals-row">
                    <th />
                    <th />
                    <th style={{ textAlign: "left", fontSize: "11px", fontWeight: 700, color: "rgba(15,23,42,0.45)" }}>Итого</th>
                    <th className="wb-table-cell--numeric wb-products-campaign-count-th">
                      {campaignTotals.total > 0 ? String(campaignTotals.total) : "—"}
                    </th>
                    <th className="wb-table-cell--numeric wb-products-campaign-count-th wb-products-campaign-active-th">
                      {campaignTotals.active > 0 ? String(campaignTotals.active) : "—"}
                    </th>
                    <th className="wb-table-cell--numeric wb-products-campaign-count-th wb-products-campaign-paused-th">
                      {campaignTotals.paused > 0 ? String(campaignTotals.paused) : "—"}
                    </th>
                    <th className="wb-table-cell--numeric wb-products-campaign-count-th wb-products-campaign-disabled-th">
                      {campaignTotals.disabled > 0 ? String(campaignTotals.disabled) : "—"}
                    </th>
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
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>{ui.noProductsFound}</td>
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
