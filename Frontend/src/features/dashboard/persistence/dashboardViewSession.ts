import type { DashboardViewState } from "./dashboardViewStateTypes";
import {
  createDefaultDashboardViewState,
  isActiveSheet,
  isDashboardSection,
  isPersistedProductsSortKey,
  isProductsMode,
  isRecord,
  isSyncEntity,
  readPersistedDateValue,
} from "./dashboardViewStateTypes";
import { writeDashboardViewStateToUrl } from "./dashboardViewUrl";

// localStorage key — persists across tab closes and browser restarts.
// Version suffix: bump when breaking schema changes require a clean slate.
const STORAGE_KEY = "wb-dashboard-view-state-v2";

export function readDashboardViewStateFromSessionStorage(): DashboardViewState {
  if (typeof window === "undefined") {
    return createDefaultDashboardViewState();
  }

  const rawValue = window.localStorage.getItem(STORAGE_KEY);
  if (!rawValue) {
    return createDefaultDashboardViewState();
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    if (!isRecord(parsedValue)) {
      return createDefaultDashboardViewState();
    }

    return {
      activeSection: isDashboardSection(parsedValue.activeSection)
        ? parsedValue.activeSection
        : "exports",
      productsMode: isProductsMode(parsedValue.productsMode) ? parsedValue.productsMode : "list",
      selectedMethodEntity: isSyncEntity(parsedValue.selectedMethodEntity)
        ? parsedValue.selectedMethodEntity
        : null,
      selectedExportId:
        typeof parsedValue.selectedExportId === "string" && parsedValue.selectedExportId.trim()
          ? parsedValue.selectedExportId
          : null,
      selectedProductNmId:
        typeof parsedValue.selectedProductNmId === "number"
          ? parsedValue.selectedProductNmId
          : null,
      selectedCatalogVendorCode:
        typeof parsedValue.selectedCatalogVendorCode === "string" &&
        parsedValue.selectedCatalogVendorCode.trim()
          ? parsedValue.selectedCatalogVendorCode
          : null,
      productAdvertisingStartDate: readPersistedDateValue(parsedValue.productAdvertisingStartDate),
      productAdvertisingEndDate: readPersistedDateValue(parsedValue.productAdvertisingEndDate),
      scrollY:
        typeof parsedValue.scrollY === "number" && parsedValue.scrollY >= 0
          ? parsedValue.scrollY
          : 0,
      // ── New fields (default-safe if missing in older stored value) ──────────
      activeSheet: isActiveSheet(parsedValue.activeSheet) ? parsedValue.activeSheet : "none",
      productsSearch:
        typeof parsedValue.productsSearch === "string" ? parsedValue.productsSearch : "",
      productsSortKey: isPersistedProductsSortKey(parsedValue.productsSortKey)
        ? parsedValue.productsSortKey
        : "name",
      productsSortDirection:
        parsedValue.productsSortDirection === "asc" || parsedValue.productsSortDirection === "desc"
          ? parsedValue.productsSortDirection
          : "asc",
    };
  } catch {
    return createDefaultDashboardViewState();
  }
}

export function writeDashboardViewStateToSessionStorage(
  currentValue: DashboardViewState,
  patch: Partial<DashboardViewState>,
  options: { urlMode?: "push" | "replace" } = {},
) {
  if (typeof window === "undefined") {
    return;
  }

  const nextValue: DashboardViewState = {
    ...currentValue,
    ...patch,
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextValue));
  } catch {
    // Quota exceeded — not fatal, next write will retry.
  }
  writeDashboardViewStateToUrl(nextValue, { mode: options.urlMode });
}

export function restoreWindowScrollPosition(
  targetScrollY: number,
  writeDashboardViewState: (patch: Partial<DashboardViewState>) => void,
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const timers: number[] = [];
  let frameId = 0;
  // 15 attempts × 100 ms = up to 1.5 s of retries to handle async page growth.
  let attemptsLeft = 15;

  const applyScroll = () => {
    const maxScrollY = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    const safeScrollY = Math.min(targetScrollY, maxScrollY);

    window.scrollTo({
      top: safeScrollY,
      behavior: "auto",
    });

    attemptsLeft -= 1;

    // Page has grown enough to reach the target — stop retrying and persist
    // the final achieved position. Do NOT write intermediate values: an early
    // retry with a small maxScrollY would overwrite the correct target and
    // make the next reload restore to the wrong position.
    const reachedTarget = safeScrollY >= targetScrollY - 1;
    if (reachedTarget || attemptsLeft <= 0) {
      writeDashboardViewState({ scrollY: safeScrollY });
      return;
    }

    const timerId = window.setTimeout(() => {
      frameId = window.requestAnimationFrame(applyScroll);
    }, 100);
    timers.push(timerId);
  };

  frameId = window.requestAnimationFrame(applyScroll);

  return () => {
    window.cancelAnimationFrame(frameId);
    for (const timerId of timers) {
      window.clearTimeout(timerId);
    }
  };
}
