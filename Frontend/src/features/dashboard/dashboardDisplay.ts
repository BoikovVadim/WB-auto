import type {
  SearchQueriesExportPayload,
  SearchQueryProduct,
  WbExportResponse,
} from "../../api/syncClient";
import { ui } from "./copy";
import { flattenRawRow } from "./rawTable";

export interface DashboardExportProductReference {
  vendorCode: string;
  nmId: number | null;
}

const displayPayloadCache = new Map<string, SearchQueriesExportPayload>();
const exportProductReferenceCache = new Map<string, DashboardExportProductReference[]>();
const exportProductIndexCache = new Map<string, Map<number, SearchQueryProduct>>();

function buildExportCacheKey(exportResponse: WbExportResponse) {
  return `${exportResponse.requestId}:${exportResponse.exportedAt}`;
}

export function looksBrokenText(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  if (trimmed.includes("�")) {
    return true;
  }

  const questionMarks = trimmed.match(/\?/g)?.length ?? 0;
  return questionMarks >= 4 && (questionMarks / trimmed.length > 0.2 || /\?{3,}/.test(trimmed));
}

function sanitizeForDisplay<T>(value: T): T {
  if (typeof value === "string") {
    return (looksBrokenText(value) ? ui.hiddenBrokenData : value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForDisplay(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sanitizeForDisplay(nestedValue)]),
    ) as T;
  }

  return value;
}

function readProductFromRow(row: Record<string, unknown>): DashboardExportProductReference | null {
  const flattenedRow = flattenRawRow(row);
  const directValue = row.vendorCode;
  const vendorCode =
    typeof directValue === "string" && directValue.trim()
      ? directValue.trim()
      : typeof flattenedRow.vendorCode === "string" && flattenedRow.vendorCode.trim()
        ? flattenedRow.vendorCode.trim()
        : null;

  if (!vendorCode) {
    return null;
  }

  const directNmId = row.nmId;
  const flattenedNmId = flattenedRow.nmId;
  const nmId =
    typeof directNmId === "number"
      ? directNmId
      : typeof flattenedNmId === "number"
        ? flattenedNmId
        : null;

  return {
    vendorCode,
    nmId,
  };
}

export function getDisplaySafeExportPayload(
  exportResponse: WbExportResponse | null,
): SearchQueriesExportPayload | null {
  if (!exportResponse) {
    return null;
  }

  const cacheKey = buildExportCacheKey(exportResponse);
  const cachedValue = displayPayloadCache.get(cacheKey);
  if (cachedValue) {
    return cachedValue;
  }

  const nextValue = sanitizeForDisplay(exportResponse.payload);
  displayPayloadCache.set(cacheKey, nextValue);
  return nextValue;
}

export function getCurrentExportProducts(
  exportResponse: WbExportResponse | null,
): DashboardExportProductReference[] {
  if (!exportResponse) {
    return [];
  }

  const cacheKey = buildExportCacheKey(exportResponse);
  const cachedValue = exportProductReferenceCache.get(cacheKey);
  if (cachedValue) {
    return cachedValue;
  }

  const payloadProductIndex = exportResponse.payload.productIndex;
  if (Array.isArray(payloadProductIndex) && payloadProductIndex.length > 0) {
    const nextValue = payloadProductIndex.map((item) => ({
      vendorCode: item.vendorCode,
      nmId: item.nmId,
    }));
    exportProductReferenceCache.set(cacheKey, nextValue);
    return nextValue;
  }

  // Compatibility fallback for older cached exports that predate `payload.productIndex`.
  const orderedVendorCodes: DashboardExportProductReference[] = [];
  const indexByVendorCode = new Map<string, number>();

  for (const table of exportResponse.payload.wbTables ?? []) {
    for (const row of table.rows) {
      const product = readProductFromRow(row);
      const vendorCode = product?.vendorCode ?? null;
      if (!vendorCode) {
        continue;
      }

      const existingIndex = indexByVendorCode.get(vendorCode);
      if (existingIndex !== undefined) {
        if (
          orderedVendorCodes[existingIndex] &&
          orderedVendorCodes[existingIndex].nmId === null &&
          product?.nmId !== null &&
          product?.nmId !== undefined
        ) {
          orderedVendorCodes[existingIndex] = {
            ...orderedVendorCodes[existingIndex],
            nmId: product.nmId,
          };
        }
        continue;
      }

      indexByVendorCode.set(vendorCode, orderedVendorCodes.length);
      orderedVendorCodes.push({
        vendorCode,
        nmId: product?.nmId ?? null,
      });
    }
  }

  for (const product of exportResponse.payload.products) {
    const vendorCode = product.vendorCode.trim();
    if (!vendorCode) {
      continue;
    }

    const existingIndex = indexByVendorCode.get(vendorCode);
    if (existingIndex !== undefined) {
      if (orderedVendorCodes[existingIndex] && orderedVendorCodes[existingIndex].nmId === null) {
        orderedVendorCodes[existingIndex] = {
          ...orderedVendorCodes[existingIndex],
          nmId: product.nmId,
        };
      }
      continue;
    }

    indexByVendorCode.set(vendorCode, orderedVendorCodes.length);
    orderedVendorCodes.push({
      vendorCode,
      nmId: product.nmId,
    });
  }

  exportProductReferenceCache.set(cacheKey, orderedVendorCodes);
  return orderedVendorCodes;
}

function getExportProductIndex(exportResponse: WbExportResponse) {
  const cacheKey = buildExportCacheKey(exportResponse);
  const cachedValue = exportProductIndexCache.get(cacheKey);
  if (cachedValue) {
    return cachedValue;
  }

  const nextValue = new Map<number, SearchQueryProduct>();
  for (const product of exportResponse.payload.products) {
    nextValue.set(product.nmId, product);
  }
  exportProductIndexCache.set(cacheKey, nextValue);
  return nextValue;
}

export function getSelectedExportProduct(
  exportResponse: WbExportResponse | null,
  selectedProductNmId: number | null,
): SearchQueryProduct | null {
  if (!exportResponse || selectedProductNmId === null) {
    return null;
  }

  return getExportProductIndex(exportResponse).get(selectedProductNmId) ?? null;
}
