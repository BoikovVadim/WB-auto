import { BadGatewayException } from "@nestjs/common";

import type {
  SearchQueryMetricValue,
  SearchQueryTextView,
} from "./wb-sync.types";
import {
  buildSearchQueriesPeriodFromCurrentRange,
  normalizeDateRange,
} from "./wb-search-queries-period";

export type SearchTextTopOrderBy =
  | "openCard"
  | "orders"
  | "addToCart"
  | "openToCart"
  | "cartToOrder";

export interface ProductSearchTextsCurrentPeriod {
  start: string;
  end: string;
}

export async function loadProductSearchTextsRangeByNmId(input: {
  nmId: number;
  currentPeriod: ProductSearchTextsCurrentPeriod;
  request: (body: Record<string, unknown>) => Promise<unknown>;
  preferredTopOrderBy?: SearchTextTopOrderBy;
  /** How many topOrderBy variants to fetch (default: all 5). Use 1 for fast scheduled syncs. */
  topOrderByCount?: number;
  limit?: number;
}): Promise<SearchQueryTextView[]> {
  const period = buildSearchQueriesPeriodFromCurrentRange(input.currentPeriod);
  const searchTextsByKey = new Map<string, SearchQueryTextView>();
  const safeLimit = getBoundedNumber(input.limit, 30, 1, 30);
  const allVariants = getProductSearchTextsTopOrderByVariants(input.preferredTopOrderBy);
  const variants =
    input.topOrderByCount !== undefined && input.topOrderByCount >= 1
      ? allVariants.slice(0, input.topOrderByCount)
      : allVariants;

  for (const topOrderBy of variants) {
    const response = await input.request({
      currentPeriod: input.currentPeriod,
      pastPeriod: {
        start: period.pastStart,
        end: period.pastEnd,
      },
      nmIds: [input.nmId],
      topOrderBy,
      includeSubstitutedSKUs: true,
      includeSearchTexts: true,
      orderBy: {
        field: "avgPosition",
        mode: "asc",
      },
      limit: safeLimit,
    });

    for (const item of extractSearchTextItems(response)) {
      const itemNmId = readNumber(item, "nmId");
      if (itemNmId !== input.nmId) {
        continue;
      }

      upsertSearchTextItem(searchTextsByKey, normalizeSearchTextItem(item));
    }
  }

  return sortSearchTextsByOpenCard(Array.from(searchTextsByKey.values()));
}

export function normalizeProductSearchTextsRange(startDate: string, endDate: string) {
  return normalizeDateRange(startDate, endDate);
}

export function getProductSearchTextsTopOrderByVariants(
  preferredTopOrderBy: SearchTextTopOrderBy = "openCard",
) {
  const validValues: SearchTextTopOrderBy[] = [
    "openCard",
    "orders",
    "addToCart",
    "openToCart",
    "cartToOrder",
  ];

  return [
    preferredTopOrderBy,
    ...validValues.filter((value) => value !== preferredTopOrderBy),
  ];
}

function extractSearchTextItems(response: unknown): unknown[] {
  const items = readNestedArray(response, ["data", "items"]);
  if (!items) {
    throw new BadGatewayException(
      "WB API returned an invalid top search texts payload.",
    );
  }

  return items;
}

function normalizeSearchTextItem(item: unknown): SearchQueryTextView {
  if (!isRecord(item)) {
    throw new BadGatewayException(
      "WB API returned an invalid search query row for a product.",
    );
  }

  return {
    text: requireString(item, "text"),
    frequency: readMetricCurrent(item, "frequency"),
    weekFrequency: readNullableNumber(item, "weekFrequency"),
    wbCluster: null,
    avgPosition: readMetricValue(item.avgPosition),
    orders: readMetricValue(item.orders),
    openCard: readMetricValue(item.openCard),
    addToCart: readMetricValue(item.addToCart),
    openToCart: readMetricValue(item.openToCart),
  };
}

function sortSearchTextsByOpenCard(searchTexts: SearchQueryTextView[]) {
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

function upsertSearchTextItem(
  byKey: Map<string, SearchQueryTextView>,
  item: SearchQueryTextView,
) {
  const key = normalizeSearchTextKey(item.text);
  const existing = byKey.get(key);
  byKey.set(key, existing ? mergeSearchTextItems(existing, item) : item);
}

function mergeSearchTextItems(
  current: SearchQueryTextView,
  incoming: SearchQueryTextView,
): SearchQueryTextView {
  return {
    text: current.text.length >= incoming.text.length ? current.text : incoming.text,
    frequency: pickGreaterNullableNumber(current.frequency, incoming.frequency),
    weekFrequency: pickGreaterNullableNumber(current.weekFrequency, incoming.weekFrequency),
    wbCluster: current.wbCluster ?? incoming.wbCluster ?? null,
    avgPosition: mergeSearchMetricValue(current.avgPosition, incoming.avgPosition),
    orders: mergeSearchMetricValue(current.orders, incoming.orders),
    openCard: mergeSearchMetricValue(current.openCard, incoming.openCard),
    addToCart: mergeSearchMetricValue(current.addToCart, incoming.addToCart),
    openToCart: mergeSearchMetricValue(current.openToCart, incoming.openToCart),
  };
}

function mergeSearchMetricValue(
  current: SearchQueryMetricValue,
  incoming: SearchQueryMetricValue,
): SearchQueryMetricValue {
  return {
    current: pickGreaterNullableNumber(current.current, incoming.current),
    dynamics: pickGreaterNullableNumber(current.dynamics, incoming.dynamics),
  };
}

function pickGreaterNullableNumber(current: number | null, incoming: number | null) {
  if (current === null) {
    return incoming;
  }

  if (incoming === null) {
    return current;
  }

  return Math.max(current, incoming);
}

function normalizeSearchTextKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

function getBoundedNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  const normalizedValue = Math.floor(value);
  return Math.min(max, Math.max(min, normalizedValue));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNestedArray(value: unknown, path: string[]) {
  let current: unknown = value;

  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }

    current = current[segment];
  }

  return Array.isArray(current) ? current : null;
}

function readNumber(value: unknown, key: string) {
  if (!isRecord(value)) {
    return null;
  }

  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function readNullableNumber(value: unknown, key: string) {
  if (!isRecord(value)) {
    return null;
  }

  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function requireString(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (typeof field !== "string" || field.trim().length === 0) {
    throw new BadGatewayException(
      `WB API returned an invalid "${key}" in product search texts.`,
    );
  }

  return field.trim();
}

function readMetricCurrent(value: unknown, key: string) {
  if (!isRecord(value)) {
    return null;
  }

  return readMetricValue(value[key]).current;
}

function readMetricValue(value: unknown): SearchQueryMetricValue {
  if (!isRecord(value)) {
    return {
      current: null,
      dynamics: null,
    };
  }

  return {
    current:
      typeof value.current === "number" && Number.isFinite(value.current)
        ? value.current
        : null,
    dynamics:
      typeof value.dynamics === "number" && Number.isFinite(value.dynamics)
        ? value.dynamics
        : null,
  };
}
