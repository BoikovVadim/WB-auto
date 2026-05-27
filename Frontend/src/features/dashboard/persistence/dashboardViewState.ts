import {
  readDashboardViewStateFromSessionStorage,
  restoreWindowScrollPosition as restoreWindowScrollPositionValue,
  writeDashboardViewStateToSessionStorage,
} from "./dashboardViewSession";
import {
  createDefaultDashboardViewState,
  type DashboardViewState,
} from "./dashboardViewStateTypes";
import { readDashboardViewStateFromUrl } from "./dashboardViewUrl";

export type { ActiveSheet, DashboardSection, DashboardViewState, PersistedProductsSortKey, ProductsMode } from "./dashboardViewStateTypes";
export { hasExplicitProductAdvertisingDateRangeInUrl } from "./dashboardViewUrl";
export {
  readPersistedCurrentExportSnapshot,
  resolveSelectedProductNmId,
  writePersistedCurrentExportSnapshot,
} from "./dashboardCurrentExportPersistence";

export function readDashboardViewState(): DashboardViewState {
  if (typeof window === "undefined") {
    return createDefaultDashboardViewState();
  }

  try {
    const storageValue = readDashboardViewStateFromSessionStorage();
    const urlValue = readDashboardViewStateFromUrl();
    const resolvedActiveSection = urlValue.activeSection ?? storageValue.activeSection;
    const hasExplicitProductsDetailDeepLink =
      resolvedActiveSection === "products" && urlValue.productsMode === "detail";

    if (resolvedActiveSection === "products") {
      return {
        activeSection: "products",
        productsMode: hasExplicitProductsDetailDeepLink ? "detail" : "list",
        selectedMethodEntity:
          urlValue.selectedMethodEntity ?? storageValue.selectedMethodEntity,
        selectedExportId: urlValue.selectedExportId ?? storageValue.selectedExportId,
        selectedProductNmId: hasExplicitProductsDetailDeepLink
          ? (urlValue.selectedProductNmId ?? null)
          : null,
        selectedCatalogVendorCode: hasExplicitProductsDetailDeepLink
          ? (urlValue.selectedCatalogVendorCode ?? null)
          : null,
        productAdvertisingStartDate:
          urlValue.productAdvertisingStartDate ?? storageValue.productAdvertisingStartDate,
        productAdvertisingEndDate:
          urlValue.productAdvertisingEndDate ?? storageValue.productAdvertisingEndDate,
        scrollY: storageValue.scrollY,
        activeSheet: storageValue.activeSheet,
        productsSearch: storageValue.productsSearch,
        productsSortKey: storageValue.productsSortKey,
        productsSortDirection: storageValue.productsSortDirection,
      };
    }

    return {
      activeSection: resolvedActiveSection,
      productsMode: "list",
      selectedMethodEntity:
        urlValue.selectedMethodEntity ?? storageValue.selectedMethodEntity,
      selectedExportId: urlValue.selectedExportId ?? storageValue.selectedExportId,
      selectedProductNmId:
        urlValue.selectedProductNmId ?? storageValue.selectedProductNmId,
      selectedCatalogVendorCode:
        urlValue.selectedCatalogVendorCode ?? storageValue.selectedCatalogVendorCode,
      productAdvertisingStartDate:
        urlValue.productAdvertisingStartDate ?? storageValue.productAdvertisingStartDate,
      productAdvertisingEndDate:
        urlValue.productAdvertisingEndDate ?? storageValue.productAdvertisingEndDate,
      scrollY: storageValue.scrollY,
      activeSheet: storageValue.activeSheet,
      productsSearch: storageValue.productsSearch,
      productsSortKey: storageValue.productsSortKey,
      productsSortDirection: storageValue.productsSortDirection,
    };
  } catch {
    return createDefaultDashboardViewState();
  }
}

export function writeDashboardViewState(patch: Partial<DashboardViewState>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const currentValue = readDashboardViewState();
    writeDashboardViewStateToSessionStorage(currentValue, patch);
  } catch {
    return;
  }
}

export function restoreWindowScrollPosition(targetScrollY: number) {
  return restoreWindowScrollPositionValue(targetScrollY, writeDashboardViewState);
}
