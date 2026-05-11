export function orderRawColumns(tableId: string, columns: string[]) {
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

export function getRawTableOrderStorageKey(tableId: string) {
  return `wb-raw-column-order:${tableId}`;
}

export function readStoredRawColumnOrder(storageKey: string, fallbackColumns: string[]) {
  if (typeof window === "undefined") {
    return fallbackColumns;
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey);

    if (!rawValue) {
      return fallbackColumns;
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return fallbackColumns;
    }

    const safeColumns = parsed.filter((value): value is string => typeof value === "string");
    return applyStoredRawColumnOrder(fallbackColumns, safeColumns);
  } catch {
    return fallbackColumns;
  }
}

export function writeStoredRawColumnOrder(storageKey: string, columns: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(columns));
  } catch {
    return;
  }
}

export function applyStoredRawColumnOrder(
  availableColumns: string[],
  savedColumns: string[],
) {
  const uniqueSavedColumns = [...new Set(savedColumns)].filter((column) =>
    availableColumns.includes(column),
  );
  const remainingColumns = availableColumns.filter(
    (column) => !uniqueSavedColumns.includes(column),
  );

  return [...uniqueSavedColumns, ...remainingColumns];
}

export function moveRawColumn(
  columns: string[],
  sourceColumn: string,
  targetColumn: string,
) {
  const nextColumns = [...columns];
  const sourceIndex = nextColumns.indexOf(sourceColumn);
  const targetIndex = nextColumns.indexOf(targetColumn);

  if (sourceIndex === -1 || targetIndex === -1) {
    return columns;
  }

  nextColumns.splice(sourceIndex, 1);
  nextColumns.splice(targetIndex, 0, sourceColumn);
  return nextColumns;
}
