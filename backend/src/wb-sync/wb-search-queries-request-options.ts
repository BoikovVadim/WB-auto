import type { SearchTextTopOrderBy } from "./product-search-texts-range";

export function getSummaryOrderBy(customPayload: Record<string, unknown> | undefined) {
  const fallback = {
    field: "avgPosition",
    mode: "asc" as const,
  };
  const orderBy = customPayload?.orderBy;

  if (!isRecord(orderBy)) {
    return fallback;
  }

  const field = readString(orderBy, "field") ?? fallback.field;
  const mode = readString(orderBy, "mode");

  return {
    field,
    mode: mode === "desc" ? "desc" : "asc",
  } as const;
}

export function getTopOrderBy(customPayload: Record<string, unknown> | undefined) {
  const value = readString(customPayload, "topOrderBy");
  const validValues: SearchTextTopOrderBy[] = [
    "openCard",
    "addToCart",
    "openToCart",
    "orders",
    "cartToOrder",
  ];

  return validValues.includes(value as SearchTextTopOrderBy) ? value : "orders";
}

export function getTopOrderByVariants(customPayload: Record<string, unknown> | undefined) {
  const preferred = getTopOrderBy(customPayload);
  const validValues: SearchTextTopOrderBy[] = [
    "openCard",
    "orders",
    "addToCart",
    "openToCart",
    "cartToOrder",
  ];

  return [preferred, ...validValues.filter((value) => value !== preferred)];
}

export function getPositionCluster(customPayload: Record<string, unknown> | undefined) {
  const value = readString(customPayload, "positionCluster");
  const validValues = ["all", "firstHundred", "secondHundred", "below"];

  return validValues.includes(value ?? "") ? value : "all";
}

export function getOptionalSummaryFilters(
  customPayload: Record<string, unknown> | undefined,
) {
  const filters: Record<string, unknown> = {};
  const subjectId = readNumber(customPayload, "subjectId");
  const brandName = readString(customPayload, "brandName");
  const tagId = readNumber(customPayload, "tagId");
  const nmIds = readNumberArray(customPayload, "nmIds");

  if (subjectId !== null) {
    filters.subjectId = subjectId;
  }

  if (brandName) {
    filters.brandName = brandName;
  }

  if (tagId !== null) {
    filters.tagId = tagId;
  }

  if (nmIds.length > 0) {
    filters.nmIds = nmIds;
  }

  return filters;
}

export function getBoundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function getBooleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function hasOwnKeys(value: Record<string, unknown> | undefined) {
  return Boolean(value && Object.keys(value).length > 0);
}

function readNumberArray(value: unknown, key: string) {
  if (!isRecord(value)) {
    return [];
  }

  const candidate = value[key];

  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.filter((item): item is number => typeof item === "number");
}

function readNumber(value: unknown, key: string) {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = value[key];

  return typeof candidate === "number" ? candidate : null;
}

function readString(value: unknown, key: string) {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = value[key];

  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
