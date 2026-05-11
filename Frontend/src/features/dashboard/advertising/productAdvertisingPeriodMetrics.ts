import type { ProductAdvertisingSheetResponse } from "../../../api/syncClient";

type ProductAdvertisingPeriodMetricsSheet = Pick<
  ProductAdvertisingSheetResponse,
  "summary"
>;

export function hasExactProductAdvertisingPeriodMetrics(
  sheet?: ProductAdvertisingPeriodMetricsSheet | null,
) {
  return sheet?.summary.periodMetricsStatus === "exact";
}

export function hasUnavailableProductAdvertisingPeriodMetrics(
  sheet?: ProductAdvertisingPeriodMetricsSheet | null,
) {
  return !!sheet && sheet.summary.periodMetricsStatus === "unavailable";
}

export function hasPartialProductAdvertisingPeriodMetrics(
  sheet?: ProductAdvertisingPeriodMetricsSheet | null,
) {
  return !!sheet && sheet.summary.periodMetricsStatus === "partial";
}
