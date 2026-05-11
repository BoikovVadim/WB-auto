import type { WbRawTable } from "../../../api/syncClient";

import { orderRawColumns } from "./rawTableColumnOrder";

const rawTableDerivedCache = new Map<
  string,
  { flattenedRows: Record<string, unknown>[]; detectedColumns: string[] }
>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasCanonicalRawTableProjection(
  table: WbRawTable,
): table is WbRawTable & {
  flattenedRows: Record<string, unknown>[];
  columns: string[];
} {
  return (
    Array.isArray(table.flattenedRows) &&
    table.flattenedRows.length === table.rows.length &&
    Array.isArray(table.columns) &&
    table.columns.length > 0
  );
}

export function getDerivedRawTableState(cacheKey: string, table: WbRawTable) {
  const cachedValue = rawTableDerivedCache.get(cacheKey);
  if (cachedValue) {
    return cachedValue;
  }

  const flattenedRows = hasCanonicalRawTableProjection(table)
    ? table.flattenedRows
    : table.rows.map((row) => flattenRawRow(row));
  const detectedColumns = hasCanonicalRawTableProjection(table)
    ? table.columns
    : (() => {
        const keys = new Set<string>();
        for (const row of flattenedRows) {
          for (const key of Object.keys(row)) {
            keys.add(key);
          }
        }
        return orderRawColumns(table.id, [...keys]);
      })();

  const nextValue = {
    flattenedRows,
    detectedColumns,
  };
  rawTableDerivedCache.set(cacheKey, nextValue);
  return nextValue;
}

export function flattenRawRow(
  value: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;

    if (isRecord(nestedValue) && !Array.isArray(nestedValue)) {
      Object.assign(result, flattenRawRow(nestedValue, nextKey));
      continue;
    }

    result[nextKey] = nestedValue;
  }

  return result;
}
