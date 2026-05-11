import type { DashboardViewState } from "./dashboardViewStateTypes";
import {
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

  if (view !== "method" && view !== "products") {
    return {};
  }

  return {
    activeSection: view === "products" ? "products" : "method",
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
  };
}

export function writeDashboardViewStateToUrl(state: DashboardViewState) {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);

  if (state.activeSection === "method" || state.activeSection === "products") {
    url.searchParams.set("view", state.activeSection);
    if (state.selectedMethodEntity) {
      url.searchParams.set("entity", state.selectedMethodEntity);
    } else {
      url.searchParams.delete("entity");
    }
    if (state.selectedExportId) {
      url.searchParams.set("exportId", state.selectedExportId);
    } else {
      url.searchParams.delete("exportId");
    }

    if (
      state.activeSection === "products" &&
      state.productsMode === "detail" &&
      state.selectedProductNmId !== null
    ) {
      url.searchParams.set("productNmId", String(state.selectedProductNmId));
    } else {
      url.searchParams.delete("productNmId");
    }
    if (
      state.activeSection === "products" &&
      state.productsMode === "detail" &&
      state.selectedCatalogVendorCode
    ) {
      url.searchParams.set("productVendor", state.selectedCatalogVendorCode);
    } else {
      url.searchParams.delete("productVendor");
    }
    if (state.productAdvertisingStartDate) {
      url.searchParams.set("adStart", state.productAdvertisingStartDate);
    } else {
      url.searchParams.delete("adStart");
    }
    if (state.productAdvertisingEndDate) {
      url.searchParams.set("adEnd", state.productAdvertisingEndDate);
    } else {
      url.searchParams.delete("adEnd");
    }
  } else {
    url.searchParams.delete("view");
    url.searchParams.delete("entity");
    url.searchParams.delete("exportId");
    url.searchParams.delete("productNmId");
    url.searchParams.delete("productVendor");
    url.searchParams.delete("adStart");
    url.searchParams.delete("adEnd");
  }

  window.history.replaceState({}, "", url);
}
