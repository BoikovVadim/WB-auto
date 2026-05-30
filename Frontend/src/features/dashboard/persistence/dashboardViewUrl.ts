import type { ActiveSheet, DashboardSection, DashboardViewState } from "./dashboardViewStateTypes";
import {
  isActiveSheet,
  isDashboardSection,
  isProductsWorkspaceSection,
  isSyncEntity,
  readPersistedDateValue,
} from "./dashboardViewStateTypes";

export function hasExplicitProductAdvertisingDateRangeInUrl() {
  if (typeof window === "undefined") {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  return Boolean(
    readPersistedDateValue(params.get("adStart")) || readPersistedDateValue(params.get("adEnd")),
  );
}

/**
 * Reads dashboard view state from the URL.
 *
 * Behaviour:
 *   - `view=method` / `view=products` — same as before, plus method/export/product
 *     deep-link params (entity, exportId, productNmId, productVendor, adStart, adEnd).
 *   - Any other valid `DashboardSection` — restores `activeSection` only; the
 *     other state lives in localStorage.
 *   - Unknown / missing `view` — returns an empty object (storage value wins).
 *
 * The URL is the source of truth on refresh and browser back/forward, so every
 * navigable section *must* be serialised here. Otherwise refresh drops the
 * user back to the default `exports` page (the "advertising page" regression).
 */
export function readDashboardViewStateFromUrl(): Partial<
  Pick<
    DashboardViewState,
    | "activeSection"
    | "productsMode"
    | "selectedMethodEntity"
    | "selectedExportId"
    | "selectedProductNmId"
    | "selectedCatalogVendorCode"
    | "productAdvertisingStartDate"
    | "productAdvertisingEndDate"
    | "activeSheet"
  >
> {
  if (typeof window === "undefined") {
    return {};
  }

  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const entity = params.get("entity");
  const exportId = params.get("exportId");
  const productNmId = params.get("productNmId");
  const productVendor = params.get("productVendor");
  const advertisingStartDate = params.get("adStart");
  const advertisingEndDate = params.get("adEnd");
  const sheetParam = params.get("sheet");

  if (view === null || !isDashboardSection(view)) {
    return {};
  }

  const activeSheet: ActiveSheet =
    isProductsWorkspaceSection(view) && isActiveSheet(sheetParam) ? sheetParam : "none";

  if (view === "method" || view === "products") {
    return {
      activeSection: view,
      productsMode:
        view === "products" &&
        (productNmId !== null || (typeof productVendor === "string" && productVendor.trim()))
          ? "detail"
          : "list",
      selectedMethodEntity: isSyncEntity(entity) ? entity : null,
      selectedExportId: exportId && exportId.trim() ? exportId : null,
      selectedProductNmId:
        productNmId !== null && !Number.isNaN(Number(productNmId))
          ? Number(productNmId)
          : null,
      selectedCatalogVendorCode:
        typeof productVendor === "string" && productVendor.trim() ? productVendor : null,
      productAdvertisingStartDate: readPersistedDateValue(advertisingStartDate),
      productAdvertisingEndDate: readPersistedDateValue(advertisingEndDate),
      activeSheet,
    };
  }

  return {
    activeSection: view satisfies DashboardSection,
    activeSheet,
  };
}

type WriteMode = "push" | "replace";

/**
 * Writes the navigation-defining slice of the view state into the URL.
 *
 * The URL always carries `?view=<section>` for any non-default section so
 * that a page refresh restores exactly the same screen. For
 * `catalog-products` we also carry `?sheet=<activeSheet>` (orders / buyout /
 * stocks / prices / cost-price) so deep links to a specific retrospective
 * sheet survive refresh.
 *
 * Use `mode: "push"` when the user navigates between sections / sheets — that
 * way browser back/forward steps through the navigation history. Use
 * `mode: "replace"` (the default) for incidental state writes (sort, search,
 * scroll) that should not pollute the history stack.
 */
export function writeDashboardViewStateToUrl(
  state: DashboardViewState,
  options: { mode?: WriteMode } = {},
) {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  const params = url.searchParams;

  // Section
  if (state.activeSection === "exports") {
    params.delete("view");
  } else {
    params.set("view", state.activeSection);
  }

  // Sheet (only meaningful for products-workspace sections)
  if (isProductsWorkspaceSection(state.activeSection) && state.activeSheet !== "none") {
    params.set("sheet", state.activeSheet);
  } else {
    params.delete("sheet");
  }

  // Method / products section deep-link params
  if (state.activeSection === "method" || state.activeSection === "products") {
    if (state.selectedMethodEntity) {
      params.set("entity", state.selectedMethodEntity);
    } else {
      params.delete("entity");
    }
    if (state.selectedExportId) {
      params.set("exportId", state.selectedExportId);
    } else {
      params.delete("exportId");
    }
    if (
      state.activeSection === "products" &&
      state.productsMode === "detail" &&
      state.selectedProductNmId !== null
    ) {
      params.set("productNmId", String(state.selectedProductNmId));
    } else {
      params.delete("productNmId");
    }
    if (
      state.activeSection === "products" &&
      state.productsMode === "detail" &&
      state.selectedCatalogVendorCode
    ) {
      params.set("productVendor", state.selectedCatalogVendorCode);
    } else {
      params.delete("productVendor");
    }
    if (state.productAdvertisingStartDate) {
      params.set("adStart", state.productAdvertisingStartDate);
    } else {
      params.delete("adStart");
    }
    if (state.productAdvertisingEndDate) {
      params.set("adEnd", state.productAdvertisingEndDate);
    } else {
      params.delete("adEnd");
    }
  } else {
    params.delete("entity");
    params.delete("exportId");
    params.delete("productNmId");
    params.delete("productVendor");
    params.delete("adStart");
    params.delete("adEnd");
  }

  const nextHref = url.toString();
  if (nextHref === window.location.href) {
    // Nothing to write — avoid producing redundant history entries on push mode
    // and avoid one extra unnecessary `replaceState` call.
    return;
  }

  if (options.mode === "push") {
    window.history.pushState({}, "", nextHref);
  } else {
    window.history.replaceState({}, "", nextHref);
  }
}

/** Section / sheet pair that defines a single history entry for back-forward navigation. */
export type DashboardNavEntry = {
  activeSection: DashboardSection;
  activeSheet: ActiveSheet;
};

/**
 * Reads section + sheet from the URL — used by the popstate handler to
 * synchronise React state when the user clicks browser back / forward.
 */
export function readNavEntryFromUrl(): DashboardNavEntry | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const sheetParam = params.get("sheet");
  if (view !== null && !isDashboardSection(view)) return null;
  const activeSection: DashboardSection = view === null ? "exports" : view;
  const activeSheet: ActiveSheet =
    isProductsWorkspaceSection(activeSection) && isActiveSheet(sheetParam) ? sheetParam : "none";
  return { activeSection, activeSheet };
}
