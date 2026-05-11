import type { SyncEntity } from "../../../api/syncClient";

export type DashboardSection = "exports" | "method" | "products";
export type ProductsMode = "list" | "detail";

export type DashboardViewState = {
  activeSection: DashboardSection;
  productsMode: ProductsMode;
  selectedMethodEntity: SyncEntity | null;
  selectedExportId: string | null;
  selectedProductNmId: number | null;
  selectedCatalogVendorCode: string | null;
  productAdvertisingStartDate: string | null;
  productAdvertisingEndDate: string | null;
  scrollY: number;
};

export function createDefaultDashboardViewState(): DashboardViewState {
  return {
    activeSection: "exports",
    productsMode: "list",
    selectedMethodEntity: null,
    selectedExportId: null,
    selectedProductNmId: null,
    selectedCatalogVendorCode: null,
    productAdvertisingStartDate: null,
    productAdvertisingEndDate: null,
    scrollY: 0,
  };
}

export function isDashboardSection(value: unknown): value is DashboardSection {
  return value === "exports" || value === "method" || value === "products";
}

export function isProductsMode(value: unknown): value is ProductsMode {
  return value === "list" || value === "detail";
}

export function isSyncEntity(value: unknown): value is SyncEntity {
  return value === "search_queries" || value === "product_search_texts";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readPersistedDateValue(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
