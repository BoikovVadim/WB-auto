import type { DashboardViewState } from "./dashboardViewStateTypes";
import {
  createDefaultDashboardViewState,
  isDashboardSection,
  isProductsMode,
  isRecord,
  isSyncEntity,
  readPersistedDateValue,
} from "./dashboardViewStateTypes";
import { writeDashboardViewStateToUrl } from "./dashboardViewUrl";

const dashboardViewStateStorageKey = "wb-dashboard-view-state";

export function readDashboardViewStateFromSessionStorage(): DashboardViewState {
  if (typeof window === "undefined") {
    return createDefaultDashboardViewState();
  }

  const rawValue = window.sessionStorage.getItem(dashboardViewStateStorageKey);
  if (!rawValue) {
    return createDefaultDashboardViewState();
  }

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
    productAdvertisingStartDate: readPersistedDateValue(
      parsedValue.productAdvertisingStartDate,
    ),
    productAdvertisingEndDate: readPersistedDateValue(
      parsedValue.productAdvertisingEndDate,
    ),
    scrollY:
      typeof parsedValue.scrollY === "number" && parsedValue.scrollY >= 0
        ? parsedValue.scrollY
        : 0,
  };
}

export function writeDashboardViewStateToSessionStorage(
  currentValue: DashboardViewState,
  patch: Partial<DashboardViewState>,
) {
  if (typeof window === "undefined") {
    return;
  }

  const nextValue: DashboardViewState = {
    ...currentValue,
    ...patch,
  };

  window.sessionStorage.setItem(
    dashboardViewStateStorageKey,
    JSON.stringify(nextValue),
  );
  writeDashboardViewStateToUrl(nextValue);
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
