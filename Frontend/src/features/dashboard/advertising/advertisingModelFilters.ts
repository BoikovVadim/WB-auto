import type { AdvertisingClusterRow } from "./advertisingModelTypes";
import {
  readAdvertisingNumericValue,
} from "./advertisingModelHelpers";
import type {
  AdvertisingClusterNumericFilterKey,
  AdvertisingClusterNumericFilters,
} from "./advertisingTableTypes";

export function createAdvertisingClusterNumericFilters(): AdvertisingClusterNumericFilters {
  return {
    jamFrequency: { min: "", max: "" },
    jamClicks: { min: "", max: "" },
    jamAddToCart: { min: "", max: "" },
    jamOrders: { min: "", max: "" },
    jamAvgPosition: { min: "", max: "" },
    jamCtc: { min: "", max: "" },
    jamCto: { min: "", max: "" },
    monthlyFrequency: { min: "", max: "" },
    bid: { min: "", max: "" },
    views: { min: "", max: "" },
    clicks: { min: "", max: "" },
    ctr: { min: "", max: "" },
    addToCart: { min: "", max: "" },
    ctc: { min: "", max: "" },
    orders: { min: "", max: "" },
    cto: { min: "", max: "" },
    avgPosition: { min: "", max: "" },
    cpc: { min: "", max: "" },
    cpm: { min: "", max: "" },
    cpo: { min: "", max: "" },
    viewToOrder: { min: "", max: "" },
    spend: { min: "", max: "" },
  };
}

export function hasAdvertisingNumericFilters(
  filters: AdvertisingClusterNumericFilters,
  filterKeys: AdvertisingClusterNumericFilterKey[],
) {
  return filterKeys.some((key) => {
    const bounds = filters[key];
    return bounds.min.trim().length > 0 || bounds.max.trim().length > 0;
  });
}

export function matchesAdvertisingNumericFilters(
  row: AdvertisingClusterRow,
  filters: AdvertisingClusterNumericFilters,
  filterKeys: AdvertisingClusterNumericFilterKey[],
) {
  return filterKeys.every((key) => {
    const minValue = parseAdvertisingNumericFilterValue(filters[key].min);
    const maxValue = parseAdvertisingNumericFilterValue(filters[key].max);

    if (minValue === null && maxValue === null) {
      return true;
    }

    const rowValue = readAdvertisingNumericValue(row, key);
    if (rowValue === null) {
      return false;
    }

    if (minValue !== null && rowValue < minValue) {
      return false;
    }

    if (maxValue !== null && rowValue > maxValue) {
      return false;
    }

    return true;
  });
}

export function getAdvertisingNumericValue(
  row: AdvertisingClusterRow,
  key: AdvertisingClusterNumericFilterKey,
) {
  return readAdvertisingNumericValue(row, key);
}

export function parseAdvertisingNumericFilterValue(value: string) {
  const normalizedValue = value.trim().replace(",", ".");
  if (!normalizedValue) {
    return null;
  }

  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}
