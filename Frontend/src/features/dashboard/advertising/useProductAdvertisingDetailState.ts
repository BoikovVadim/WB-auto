import { useMemo } from "react";

import {
  type ProductAdvertisingSheetResponse,
  type WbExportResponse,
} from "../../../api/syncClient";
import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import type { AdvertisingDateRange } from "./date";
import { buildProductAdvertisingPresetPlan } from "./productAdvertisingPresetPlan";
import {
  hasResolvedProductAdvertisingSheet,
  matchesProductAdvertisingSheetRequest,
  resolveEffectiveProductAdvertisingRequestInput,
} from "./productAdvertisingResolvedRange";
import { usePreparedProductAdvertisingSheets } from "./usePreparedProductAdvertisingSheets";
import { useProductAdvertisingSheetQuery } from "./useProductAdvertisingSheetQuery";

function getPreparedMatchingRequestSheet(
  preparedSheets: Record<string, ProductAdvertisingSheetResponse | null>,
  nmId: number | null,
  requestInput: ProductAdvertisingSheetRequestInput | null,
) {
  for (const preparedSheet of Object.values(preparedSheets)) {
    if (matchesProductAdvertisingSheetRequest(preparedSheet, nmId, requestInput)) {
      return preparedSheet;
    }
  }

  return null;
}

export function useProductAdvertisingDetailState(input: {
  active: boolean;
  currentExport: WbExportResponse | null;
  initialProductAdvertisingSheet: ProductAdvertisingSheetResponse | null;
  resolvedCatalogProduct: {
    vendorCode: string;
    nmId: number | null;
  } | null;
  productAdvertisingDateRange: AdvertisingDateRange;
  refreshKey?: number;
  preparedWarmupEnabled?: boolean;
  sheetNetworkMode?: "cache-only" | "cache-and-network";
}) {
  const nmId = input.resolvedCatalogProduct?.nmId ?? null;
  const presetPlan = useMemo(
    () =>
      buildProductAdvertisingPresetPlan({
        currentExport: input.currentExport,
        initialProductAdvertisingSheet: input.initialProductAdvertisingSheet,
        productAdvertisingDateRange: input.productAdvertisingDateRange,
        selectedProductNmId: nmId,
      }),
    [
      input.currentExport,
      input.initialProductAdvertisingSheet,
      input.productAdvertisingDateRange,
      nmId,
    ],
  );
  const {
    preparedProductAdvertisingSheets,
    activeProductAdvertisingBootstrapSheet,
  } = usePreparedProductAdvertisingSheets({
    active: input.active && input.preparedWarmupEnabled === true,
    nmId,
    warmRequestInputs: presetPlan.warmRequestInputs,
    warmRequestKeys: presetPlan.warmRequestKeys,
    activeRequestInput: presetPlan.activeRequestInput,
    activeRequestKey: presetPlan.activeRequestKey,
    initialProductAdvertisingSheet: input.initialProductAdvertisingSheet,
  });
  const activeRequestInput = presetPlan.activeRequestInput;
  const requestInput = activeRequestInput;
  const bootstrapSheet = useMemo(() => {
    if (!input.active || nmId === null || !requestInput) {
      return null;
    }

    if (
      matchesProductAdvertisingSheetRequest(activeProductAdvertisingBootstrapSheet, nmId, requestInput)
    ) {
      return activeProductAdvertisingBootstrapSheet;
    }

    if (
      input.initialProductAdvertisingSheet &&
      matchesProductAdvertisingSheetRequest(input.initialProductAdvertisingSheet, nmId, requestInput)
    ) {
      return input.initialProductAdvertisingSheet;
    }

    return null;
  }, [
    activeProductAdvertisingBootstrapSheet,
    input.active,
    input.initialProductAdvertisingSheet,
    nmId,
    requestInput,
  ]);
  const detailQuery = useProductAdvertisingSheetQuery({
    active: input.active,
    nmId,
    requestInput,
    initialSheet: input.initialProductAdvertisingSheet,
    bootstrapSheet,
    refreshKey: input.refreshKey,
    networkMode: input.sheetNetworkMode ?? "cache-and-network",
  });
  const displaySheet = useMemo(() => {
    if (hasResolvedProductAdvertisingSheet(detailQuery.productAdvertisingSheet, nmId)) {
      return detailQuery.productAdvertisingSheet;
    }

    if (hasResolvedProductAdvertisingSheet(bootstrapSheet, nmId)) {
      return bootstrapSheet;
    }

    const preparedMatchingSheet = getPreparedMatchingRequestSheet(
      preparedProductAdvertisingSheets,
      nmId,
      requestInput,
    );
    if (preparedMatchingSheet) {
      return preparedMatchingSheet;
    }

    if (hasResolvedProductAdvertisingSheet(input.initialProductAdvertisingSheet, nmId)) {
      return input.initialProductAdvertisingSheet;
    }

    return null;
  }, [
    bootstrapSheet,
    detailQuery.productAdvertisingSheet,
    input.initialProductAdvertisingSheet,
    nmId,
    preparedProductAdvertisingSheets,
    requestInput,
  ]);
  const effectiveRequestInput = useMemo(
    () =>
      resolveEffectiveProductAdvertisingRequestInput({
        preferredRequestInput: requestInput,
        sheet: displaySheet,
      }),
    [displaySheet, requestInput],
  );

  return {
    ...detailQuery,
    preparedProductAdvertisingSheets,
    productAdvertisingBootstrapSheet: bootstrapSheet,
    productAdvertisingSheet: displaySheet,
    productAdvertisingSheetRequestInput: effectiveRequestInput,
  };
}
