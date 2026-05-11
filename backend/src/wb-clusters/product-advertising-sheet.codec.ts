import { HttpException, HttpStatus } from "@nestjs/common";

import type {
  SearchQueryMetricValue,
  SearchQueryTextView,
} from "../wb-sync/wb-sync.types";

export function extractAdvertisingSheetSearchTextItems(response: unknown) {
  if (!isAdvertisingSheetRecord(response)) {
    throw new HttpException(
      "WB API returned an invalid top search texts payload.",
      HttpStatus.BAD_GATEWAY,
    );
  }

  const data = response.data;
  if (!isAdvertisingSheetRecord(data) || !Array.isArray(data.items)) {
    throw new HttpException(
      "WB API returned an invalid top search texts payload.",
      HttpStatus.BAD_GATEWAY,
    );
  }

  return data.items;
}

export function normalizeAdvertisingSheetSearchTextItem(input: {
  item: unknown;
  toNullableNumber: (value: unknown) => number | null;
}): SearchQueryTextView {
  if (!isAdvertisingSheetRecord(input.item)) {
    throw new HttpException(
      "WB API returned an invalid search query row for a product.",
      HttpStatus.BAD_GATEWAY,
    );
  }

  return {
    text: requireAdvertisingSheetString(input.item, "text"),
    frequency: readAdvertisingSheetMetricCurrent(input.item.frequency, input.toNullableNumber),
    weekFrequency: input.toNullableNumber(input.item.weekFrequency),
    wbCluster: null,
    avgPosition: readAdvertisingSheetMetricValue(input.item.avgPosition, input.toNullableNumber),
    orders: readAdvertisingSheetMetricValue(input.item.orders, input.toNullableNumber),
    openCard: readAdvertisingSheetMetricValue(input.item.openCard, input.toNullableNumber),
    addToCart: readAdvertisingSheetMetricValue(input.item.addToCart, input.toNullableNumber),
    openToCart: readAdvertisingSheetMetricValue(input.item.openToCart, input.toNullableNumber),
  };
}

export function formatAdvertisingSheetDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addAdvertisingSheetDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

export function parseAdvertisingSheetDayValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getAdvertisingSheetStartOfDayTimestamp(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function getAdvertisingSheetTopOrderByVariants() {
  return ["openCard", "orders", "addToCart", "openToCart", "cartToOrder"] as const;
}

export function sortAdvertisingSheetSearchTextsByOpenCard(searchTexts: SearchQueryTextView[]) {
  return [...searchTexts].sort((left, right) => {
    const clickDiff =
      (right.openCard.current ?? Number.NEGATIVE_INFINITY) -
      (left.openCard.current ?? Number.NEGATIVE_INFINITY);
    if (clickDiff !== 0) {
      return clickDiff;
    }

    const frequencyDiff =
      (right.frequency ?? Number.NEGATIVE_INFINITY) -
      (left.frequency ?? Number.NEGATIVE_INFINITY);
    if (frequencyDiff !== 0) {
      return frequencyDiff;
    }

    return left.text.localeCompare(right.text, "ru");
  });
}

export function normalizeAdvertisingText(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/[_/\\|.,:;!?()[\]{}"'+=*%#№@`~^&-]+/g, " ")
    .replace(/\s+/g, " ");
}

function isAdvertisingSheetRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireAdvertisingSheetString(
  value: Record<string, unknown>,
  key: string,
) {
  const currentValue = value[key];
  if (typeof currentValue !== "string" || !currentValue.trim()) {
    throw new HttpException(
      `WB API returned an invalid search text field: ${key}.`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  return currentValue.trim();
}

function readAdvertisingSheetMetricCurrent(
  value: unknown,
  toNullableNumber: (value: unknown) => number | null,
) {
  if (!isAdvertisingSheetRecord(value)) {
    return null;
  }

  return toNullableNumber(value.current);
}

function readAdvertisingSheetMetricValue(
  value: unknown,
  toNullableNumber: (value: unknown) => number | null,
): SearchQueryMetricValue {
  if (!isAdvertisingSheetRecord(value)) {
    return { current: null, dynamics: null };
  }

  return {
    current: toNullableNumber(value.current),
    dynamics: toNullableNumber(value.dynamics),
  };
}
