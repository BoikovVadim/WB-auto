import type { SyncEntity } from "../../../api/syncClient";

export type DashboardSection =
  | "exports"
  | "method"
  | "products"
  | "catalog-products"
  | "jam"
  | "catalog"
  | "campaigns"
  | "sync-runs"
  | "cluster-stats"
  | "daily-stats"
  | "minus-phrases"
  | "query-frequencies"
  | "dashboard"
  | "dashboard-tech"
  | "dashboard-cabinet"
  | "change-history";

export type ProductsMode = "list" | "detail";

// Overlay sheet active within catalog-products section.
// "none" means the main products table is shown.
export type ActiveSheet = "none" | "cost-price" | "orders" | "stocks";

// Valid sort keys for the products table — must stay in sync with ProductListSortKey.
export type PersistedProductsSortKey =
  | "id" | "name" | "category" | "subject"
  | "total" | "active" | "paused" | "disabled";

// ─── DashboardViewState ───────────────────────────────────────────────────────
// RULE: Every piece of navigation/view state that affects which screen the user
// sees MUST be listed here and handled in read/write functions below.
// If you add a new useState in WbDashboard.tsx that affects routing/overlays,
// add it here too — see docs/module-map.md § "nav-state-persistence".
// ─────────────────────────────────────────────────────────────────────────────
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
  // ── Overlay / sheet state ──────────────────────────────────────────────────
  activeSheet: ActiveSheet;
  // ── Products table view state ─────────────────────────────────────────────
  productsSearch: string;
  productsSortKey: PersistedProductsSortKey;
  productsSortDirection: "asc" | "desc";
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
    activeSheet: "none",
    productsSearch: "",
    productsSortKey: "name",
    productsSortDirection: "asc",
  };
}

export function isActiveSheet(value: unknown): value is ActiveSheet {
  return value === "none" || value === "cost-price" || value === "orders" || value === "stocks";
}

export function isPersistedProductsSortKey(value: unknown): value is PersistedProductsSortKey {
  return (
    value === "id" || value === "name" || value === "category" || value === "subject" ||
    value === "total" || value === "active" || value === "paused" || value === "disabled"
  );
}

export function isDashboardSection(value: unknown): value is DashboardSection {
  return (
    value === "exports" ||
    value === "method" ||
    value === "products" ||
    value === "catalog-products" ||
    value === "jam" ||
    value === "catalog" ||
    value === "campaigns" ||
    value === "sync-runs" ||
    value === "cluster-stats" ||
    value === "daily-stats" ||
    value === "minus-phrases" ||
    value === "query-frequencies" ||
    value === "dashboard" ||
    value === "dashboard-tech" ||
    value === "dashboard-cabinet" ||
    value === "change-history"
  );
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
