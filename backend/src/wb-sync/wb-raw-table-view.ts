import type { WbRawTableView } from "./wb-sync.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function flattenRawTableRow(
  value: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;

    if (isRecord(nestedValue) && !Array.isArray(nestedValue)) {
      Object.assign(result, flattenRawTableRow(nestedValue, nextKey));
      continue;
    }

    result[nextKey] = nestedValue;
  }

  return result;
}

export function orderRawTableColumns(tableId: string, columns: string[]) {
  const preferredColumns =
    tableId === "wb-search-texts"
      ? [
          "vendorCode",
          "text",
          "nmId",
          "name",
          "brandName",
          "subjectName",
          "openCard.current",
          "frequency.current",
          "weekFrequency",
          "avgPosition.current",
          "orders.current",
          "addToCart.current",
          "openToCart.current",
          "cartToOrder.current",
          "visibility.current",
        ]
      : ["vendorCode", "nmId", "name", "brandName", "subjectName"];

  const rank = new Map(preferredColumns.map((column, index) => [column, index]));

  return [...columns].sort((left, right) => {
    const leftRank = rank.get(left);
    const rightRank = rank.get(right);

    if (leftRank !== undefined && rightRank !== undefined) {
      return leftRank - rightRank;
    }

    if (leftRank !== undefined) {
      return -1;
    }

    if (rightRank !== undefined) {
      return 1;
    }

    return left.localeCompare(right, "ru");
  });
}

export function buildRawTableView(input: {
  id: string;
  title: string;
  rows: Record<string, unknown>[];
}): WbRawTableView {
  const flattenedRows = input.rows.map((row) => flattenRawTableRow(row));
  const keys = new Set<string>();

  for (const row of flattenedRows) {
    for (const key of Object.keys(row)) {
      keys.add(key);
    }
  }

  return {
    id: input.id,
    title: input.title,
    rows: input.rows,
    flattenedRows,
    columns: orderRawTableColumns(input.id, [...keys]),
  };
}
