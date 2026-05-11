import { useMemo } from "react";

import type { SyncEntity, WbExportResponse } from "../../api/syncClient";
import {
  getCurrentExportProducts,
  getDisplaySafeExportPayload,
  getSelectedExportProduct,
} from "./dashboardDisplay";

export function useDashboardExportView(input: {
  currentExport: WbExportResponse | null;
  primaryEntityType: SyncEntity;
  selectedProductNmId: number | null;
}) {
  const currentProductExport = useMemo(
    () => (input.currentExport?.entityType === input.primaryEntityType ? input.currentExport : null),
    [input.currentExport, input.primaryEntityType],
  );
  const displayPayload = useMemo(
    () => getDisplaySafeExportPayload(input.currentExport),
    [input.currentExport],
  );
  const currentExportProducts = useMemo(
    () => getCurrentExportProducts(currentProductExport),
    [currentProductExport],
  );
  const selectedProduct = useMemo(
    () => getSelectedExportProduct(currentProductExport, input.selectedProductNmId),
    [currentProductExport, input.selectedProductNmId],
  );

  return {
    currentProductExport,
    currentExportProducts,
    displayPayload,
    selectedProduct,
  };
}
