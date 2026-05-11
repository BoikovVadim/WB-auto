import { useMemo } from "react";

import {
  getCachedExportHistory,
  getCachedExportMethods,
  type ExportMethodStatus,
  type SyncEntity,
  type WbExportListItem,
  type WbExportResponse,
} from "../../api/syncClient";
import {
  type AdvertisingDateRange,
  parseAdvertisingDayValue,
} from "./advertising/date";
import {
  resolveInitialProductAdvertisingDateRange,
} from "./advertising/productAdvertisingDateRangeState";
import {
  type ProductsMode,
  hasExplicitProductAdvertisingDateRangeInUrl,
  readDashboardViewState,
  readPersistedCurrentExportSnapshot,
  resolveSelectedProductNmId,
} from "./persistence/dashboardViewState";

export function useDashboardInitialState(primaryEntityType: SyncEntity) {
  const persistedViewState = useMemo(() => readDashboardViewState(), []);
  const cachedExportMethods = useMemo(() => getCachedExportMethods() ?? [], []);
  const cachedExportHistory = useMemo(() => getCachedExportHistory() ?? [], []);
  const cachedLatestProductExport = useMemo(
    () => cachedExportHistory.find((item) => item.entityType === primaryEntityType) ?? null,
    [cachedExportHistory, primaryEntityType],
  );
  const initialSelectedMethodEntity =
    persistedViewState.activeSection === "products" ||
    persistedViewState.selectedMethodEntity === primaryEntityType
      ? primaryEntityType
      : null;
  const initialSelectedExportId = useMemo(() => {
    if (persistedViewState.selectedExportId) {
      return persistedViewState.selectedExportId;
    }

    if (persistedViewState.activeSection !== "products") {
      return null;
    }

    return cachedLatestProductExport?.requestId ?? null;
  }, [
    cachedLatestProductExport,
    persistedViewState.activeSection,
    persistedViewState.selectedExportId,
  ]);
  const persistedCurrentExport = useMemo<WbExportResponse | null>(
    () =>
      persistedViewState.activeSection === "products" && !persistedViewState.selectedExportId
        ? readPersistedCurrentExportSnapshot(null, initialSelectedMethodEntity)
        : readPersistedCurrentExportSnapshot(
            initialSelectedExportId,
            initialSelectedMethodEntity,
          ),
    [
      initialSelectedExportId,
      initialSelectedMethodEntity,
      persistedViewState.activeSection,
      persistedViewState.selectedExportId,
    ],
  );
  const initialProductAdvertisingDateRange = useMemo<AdvertisingDateRange>(() => {
    const persistedStartDate = persistedViewState.productAdvertisingStartDate
      ? parseAdvertisingDayValue(persistedViewState.productAdvertisingStartDate)
      : null;
    const persistedEndDate = persistedViewState.productAdvertisingEndDate
      ? parseAdvertisingDayValue(persistedViewState.productAdvertisingEndDate)
      : null;
    return resolveInitialProductAdvertisingDateRange({
      persistedStartDate,
      persistedEndDate,
      hasExplicitDateRangeInUrl: hasExplicitProductAdvertisingDateRangeInUrl(),
      isInDetailMode: persistedViewState.productsMode === "detail",
    });
  }, [
    persistedViewState.productAdvertisingEndDate,
    persistedViewState.productAdvertisingStartDate,
    persistedViewState.productsMode,
  ]);
  const initialSelectedProductNmId = useMemo(
    () =>
      resolveSelectedProductNmId(
        persistedCurrentExport,
        persistedViewState.selectedProductNmId,
      ),
    [persistedCurrentExport, persistedViewState.selectedProductNmId],
  );
  const initialProductsMode = useMemo<ProductsMode>(
    () =>
      persistedViewState.activeSection === "products" &&
      persistedViewState.productsMode === "detail"
        ? "detail"
        : "list",
    [persistedViewState.activeSection, persistedViewState.productsMode],
  );

  return {
    persistedViewState,
    cachedExportMethods: cachedExportMethods.filter(
      (method: ExportMethodStatus) => method.entityType === primaryEntityType,
    ),
    cachedExportHistory: cachedExportHistory.filter(
      (item: WbExportListItem) => item.entityType === primaryEntityType,
    ),
    initialSelectedMethodEntity,
    initialSelectedExportId,
    persistedCurrentExport,
    initialProductAdvertisingDateRange,
    initialSelectedProductNmId,
    initialProductsMode,
  };
}
