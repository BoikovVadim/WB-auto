import { useMemo } from "react";

import type {
  ProductAdvertisingSheetResponse,
  WbExportResponse,
} from "../../../api/syncClient";
import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import {
  formatCalendarDateValue,
  getStartOfCalendarDay,
  resolveJamRangePeriod,
  type AdvertisingDateRange,
} from "./date";

export function resolveProductAdvertisingSheetPeriod(input: {
  currentExport: WbExportResponse | null;
  initialProductAdvertisingSheet: ProductAdvertisingSheetResponse | null;
  selectedProductNmId: number | null;
  productAdvertisingDateRange: AdvertisingDateRange;
}) {
  if (input.productAdvertisingDateRange.start || input.productAdvertisingDateRange.end) {
    const explicitStart = getStartOfCalendarDay(
      input.productAdvertisingDateRange.start ??
        input.productAdvertisingDateRange.end ??
        new Date(),
    );
    const explicitEnd = getStartOfCalendarDay(
      input.productAdvertisingDateRange.end ??
        input.productAdvertisingDateRange.start ??
        new Date(),
    );

    return {
      startDate: formatCalendarDateValue(
        explicitStart.getTime() <= explicitEnd.getTime() ? explicitStart : explicitEnd,
      ),
      endDate: formatCalendarDateValue(
        explicitEnd.getTime() >= explicitStart.getTime() ? explicitEnd : explicitStart,
      ),
      usesExportPeriod: false,
    };
  }

  const sheetRange =
    input.initialProductAdvertisingSheet &&
    input.selectedProductNmId !== null &&
    input.initialProductAdvertisingSheet.nmId === input.selectedProductNmId
      ? input.initialProductAdvertisingSheet.range
      : null;

  if (sheetRange?.startDate && sheetRange?.endDate) {
    return {
      startDate: sheetRange.startDate,
      endDate: sheetRange.endDate,
      usesExportPeriod: false,
    };
  }

  if (input.currentExport?.entityType === "product_search_texts") {
    return resolveJamRangePeriod(
      input.productAdvertisingDateRange,
      input.currentExport.payload.period,
      null,
    );
  }

  const today = getStartOfCalendarDay(new Date());
  const todayValue = formatCalendarDateValue(today);
  return {
    startDate: todayValue,
    endDate: todayValue,
    usesExportPeriod: false,
  };
}

export function resolveProductAdvertisingSheetRequestInput(input: {
  currentExport: WbExportResponse | null;
  initialProductAdvertisingSheet: ProductAdvertisingSheetResponse | null;
  selectedProductNmId: number | null;
  productAdvertisingDateRange: AdvertisingDateRange;
}): ProductAdvertisingSheetRequestInput {
  const productAdvertisingSheetPeriod = resolveProductAdvertisingSheetPeriod(input);
  const exactProductAdvertisingExportRequestId =
    input.currentExport &&
    input.currentExport.entityType === "product_search_texts" &&
    input.currentExport.payload.period.currentStart === productAdvertisingSheetPeriod.startDate &&
    input.currentExport.payload.period.currentEnd === productAdvertisingSheetPeriod.endDate
      ? input.currentExport.requestId
      : undefined;

  return {
    startDate: productAdvertisingSheetPeriod.startDate,
    endDate: productAdvertisingSheetPeriod.endDate,
    exportRequestId: exactProductAdvertisingExportRequestId,
  };
}

export function useProductAdvertisingRequestInput(input: {
  currentExport: WbExportResponse | null;
  initialProductAdvertisingSheet: ProductAdvertisingSheetResponse | null;
  resolvedCatalogProduct: {
    vendorCode: string;
    nmId: number | null;
  } | null;
  productAdvertisingDateRange: AdvertisingDateRange;
}) {
  return useMemo(
    () =>
      resolveProductAdvertisingSheetRequestInput({
        currentExport: input.currentExport,
        initialProductAdvertisingSheet: input.initialProductAdvertisingSheet,
        selectedProductNmId: input.resolvedCatalogProduct?.nmId ?? null,
        productAdvertisingDateRange: input.productAdvertisingDateRange,
      }),
    [
      input.currentExport,
      input.initialProductAdvertisingSheet,
      input.productAdvertisingDateRange,
      input.resolvedCatalogProduct?.nmId,
    ],
  );
}
