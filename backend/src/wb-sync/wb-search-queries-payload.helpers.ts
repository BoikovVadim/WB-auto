import { BadGatewayException } from "@nestjs/common";

import type {
  SearchQueriesExportPayload,
  SearchQueryMetricValue,
  SearchQueryProductView,
  SearchQueryTextView,
} from "./wb-sync.types";

export function buildExportProductIndex(products: SearchQueriesExportPayload["products"]) {
  const itemsByVendorCode = new Map<
    string,
    {
      vendorCode: string;
      nmId: number;
    }
  >();

  for (const product of products) {
    const vendorCode = product.vendorCode.trim();
    if (!vendorCode || !Number.isInteger(product.nmId) || product.nmId <= 0) {
      continue;
    }

    if (!itemsByVendorCode.has(vendorCode)) {
      itemsByVendorCode.set(vendorCode, {
        vendorCode,
        nmId: product.nmId,
      });
    }
  }

  return Array.from(itemsByVendorCode.values());
}

export function extractSummaryProducts(response: unknown): unknown[] {
  const groups = readNestedArray(response, ["data", "groups"]);

  if (!groups) {
    throw new BadGatewayException(
      "WB API returned an invalid summary payload for search queries.",
    );
  }

  const products: unknown[] = [];

  for (const group of groups) {
    const items = readNestedArray(group, ["items"]);

    if (!items) {
      continue;
    }

    products.push(...items);
  }

  return products;
}

export function extractSearchTextItems(response: unknown): unknown[] {
  const items = readNestedArray(response, ["data", "items"]);

  if (!items) {
    throw new BadGatewayException(
      "WB API returned an invalid top search texts payload.",
    );
  }

  return items;
}

export function normalizeSummaryProduct(
  product: unknown,
  searchTextsByNmId: Map<number, SearchQueryTextView[]>,
): SearchQueryProductView {
  if (!isRecord(product)) {
    throw new BadGatewayException(
      "WB API returned an invalid product row in the search queries report.",
    );
  }

  const nmId = requireNumber(product, "nmId");

  return {
    nmId,
    name: readDisplayString(product, "name", `nmId ${nmId}`),
    vendorCode: readDisplayString(product, "vendorCode"),
    brandName: readDisplayString(product, "brandName"),
    subjectName: readDisplayString(product, "subjectName"),
    avgPosition: readMetricValue(product.avgPosition),
    openCard: readMetricValue(product.openCard),
    addToCart: readMetricValue(product.addToCart),
    openToCart: readMetricValue(product.openToCart),
    orders: readMetricValue(product.orders),
    cartToOrder: readMetricValue(product.cartToOrder),
    visibility: readMetricValue(product.visibility),
    searchTexts: searchTextsByNmId.get(nmId) ?? [],
  };
}

export function normalizeSearchTextItem(item: unknown): SearchQueryTextView {
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

export function sortSearchTextsByOpenCard(searchTexts: SearchQueryTextView[]) {
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

export function upsertSearchTextItem(
  byNmId: Map<number, Map<string, SearchQueryTextView>>,
  nmId: number,
  item: SearchQueryTextView,
) {
  const key = normalizeClusterLookupKey(item.text);
  const currentItems = byNmId.get(nmId) ?? new Map<string, SearchQueryTextView>();
  const existing = currentItems.get(key);

  currentItems.set(key, existing ? mergeSearchTextItems(existing, item) : item);
  byNmId.set(nmId, currentItems);
}

export function normalizeClusterLookupKey(value: string) {
  return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
}

export function sortRawSearchTextRowsByOpenCard(rows: Record<string, unknown>[]) {
  return [...rows].sort((left, right) => {
    const leftNmId = readNumber(left, "nmId") ?? Number.POSITIVE_INFINITY;
    const rightNmId = readNumber(right, "nmId") ?? Number.POSITIVE_INFINITY;
    const nmIdDiff = leftNmId - rightNmId;

    if (nmIdDiff !== 0) {
      return nmIdDiff;
    }

    const clickDiff =
      (readMetricCurrent(right, "openCard") ?? Number.NEGATIVE_INFINITY) -
      (readMetricCurrent(left, "openCard") ?? Number.NEGATIVE_INFINITY);

    if (clickDiff !== 0) {
      return clickDiff;
    }

    return (readString(left, "text") ?? "").localeCompare(
      readString(right, "text") ?? "",
      "ru",
    );
  });
}

export function readNumber(value: unknown, key: string) {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = value[key];

  return typeof candidate === "number" ? candidate : null;
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

function readMetricValue(value: unknown): SearchQueryMetricValue {
  if (!isRecord(value)) {
    return {
      current: null,
      dynamics: null,
    };
  }

  return {
    current: readNullableNumber(value, "current"),
    dynamics: readNullableNumber(value, "dynamics"),
  };
}

function readMetricCurrent(value: unknown, key: string) {
  const nestedValue =
    isRecord(value) && isRecord(value[key]) ? value[key] : null;

  if (nestedValue) {
    return readNullableNumber(nestedValue, "current");
  }

  return readNullableNumber(value, key);
}

function readNestedArray(value: unknown, keys: string[]) {
  let current: unknown = value;

  for (const key of keys) {
    if (!isRecord(current)) {
      return null;
    }

    current = current[key];
  }

  return Array.isArray(current) ? current : null;
}

function readNullableNumber(value: unknown, key: string) {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = value[key];

  return typeof candidate === "number" ? candidate : null;
}

function requireNumber(value: unknown, key: string) {
  const candidate = readNumber(value, key);

  if (candidate === null) {
    throw new BadGatewayException(
      `WB API did not return required numeric field: ${key}.`,
    );
  }

  return candidate;
}

function readString(value: unknown, key: string) {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = value[key];

  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function requireString(value: unknown, key: string) {
  const candidate = readString(value, key);

  if (!candidate) {
    throw new BadGatewayException(
      `WB API did not return required string field: ${key}.`,
    );
  }

  return candidate;
}

function readDisplayString(value: unknown, key: string, fallback = "-") {
  return readString(value, key) ?? fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
