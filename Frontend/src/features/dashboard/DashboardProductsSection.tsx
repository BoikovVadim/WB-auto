import type { ReactNode } from "react";

import { ui } from "./copy";
import { ProductsWorkspaceSection } from "./ProductsWorkspaceSection";
import type { ProductListItem, ProductListSortKey } from "./useDashboardProductsWorkspace";

type DashboardProductsSectionProps = {
  productsMode: "list" | "detail";
  resolvedCatalogProduct: ProductListItem | null;
  productCatalogCount: number;
  productsSearch: string;
  hasCatalogItems: boolean;
  isCatalogLoading: boolean;
  filteredProducts: ProductListItem[];
  productsSortKey: ProductListSortKey;
  productsSortDirection: "asc" | "desc";
  detailWorkspace: ReactNode;
  onProductsSearchChange: (value: string) => void;
  onProductsSortToggle: (key: ProductListSortKey) => void;
  onProductOpen: (product: ProductListItem) => void;
  onProductHover: (nmId: number | null) => void;
  onProductFocus: (nmId: number | null) => void;
  onBackToProducts: () => void;
};

export function DashboardProductsSection(props: DashboardProductsSectionProps) {
  const detailTitle = props.resolvedCatalogProduct
    ? props.resolvedCatalogProduct.nmId !== null
      ? (
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: "8px" }}>
            <span>{props.resolvedCatalogProduct.nmId} {props.resolvedCatalogProduct.vendorCode}</span>
            {props.resolvedCatalogProduct.subjectName && (
              <span style={{ fontSize: "0.55em", fontWeight: 400, opacity: 0.6 }}>
                {props.resolvedCatalogProduct.subjectName}
              </span>
            )}
          </span>
        )
      : props.resolvedCatalogProduct.vendorCode
    : `${ui.productsWorkspace} (${props.productCatalogCount})`;

  return (
    <section className="wb-card wb-card--wide">
      {props.productsMode === "detail" ? (
        <div className="wb-workspace-header wb-workspace-header--products-detail">
          <h2>{detailTitle}</h2>
          <button
            className="wb-secondary-button"
            type="button"
            onClick={props.onBackToProducts}
          >
            {ui.backToProducts}
          </button>
        </div>
      ) : (
        <div className="wb-workspace-header wb-workspace-header--products-list">
          <h2 className="wb-products-list-title">{`${ui.productsWorkspace} — ${props.productCatalogCount}`}</h2>
          <div className="wb-products-toolbar">
            <input
              className="wb-input wb-products-search"
              type="search"
              value={props.productsSearch}
              onChange={(event) => props.onProductsSearchChange(event.target.value)}
              placeholder={ui.productsSearchPlaceholder}
            />
          </div>
        </div>
      )}

      <ProductsWorkspaceSection
        hasCatalogItems={props.hasCatalogItems}
        isCatalogLoading={props.isCatalogLoading}
        productsMode={props.productsMode}
        resolvedCatalogProduct={props.resolvedCatalogProduct}
        filteredProducts={props.filteredProducts}
        productsSortKey={props.productsSortKey}
        productsSortDirection={props.productsSortDirection}
        onProductsSortToggle={props.onProductsSortToggle}
        onProductOpen={props.onProductOpen}
        onProductHover={props.onProductHover}
        onProductFocus={props.onProductFocus}
        detailWorkspace={props.detailWorkspace}
      />
    </section>
  );
}
