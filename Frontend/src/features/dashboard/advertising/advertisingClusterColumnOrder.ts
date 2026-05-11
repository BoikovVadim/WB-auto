import {
  applyStoredRawColumnOrder,
  moveRawColumn,
  readStoredRawColumnOrder,
  writeStoredRawColumnOrder,
} from "../rawTable";
import type { AdvertisingColumnDefinition } from "./advertisingClusterTableColumns";
import type { AdvertisingClusterSortKey } from "./advertisingTableTypes";

export function readStoredAdvertisingColumnOrder(
  storageKey: string,
  fallbackColumns: AdvertisingClusterSortKey[],
) {
  const storedColumns = readStoredRawColumnOrder(storageKey, fallbackColumns);
  return storedColumns.filter((value): value is AdvertisingClusterSortKey =>
    fallbackColumns.includes(value as AdvertisingClusterSortKey),
  );
}

export function writeStoredAdvertisingColumnOrder(
  storageKey: string,
  columns: AdvertisingClusterSortKey[],
) {
  writeStoredRawColumnOrder(storageKey, columns);
}

export function applyStoredAdvertisingColumnOrder(
  availableColumns: AdvertisingColumnDefinition[],
  savedColumns: AdvertisingClusterSortKey[],
) {
  const availableKeys = availableColumns.map((column) => column.key);
  const resolvedKeys = applyStoredRawColumnOrder(availableKeys, savedColumns);
  const columnByKey = new Map(availableColumns.map((column) => [column.key, column]));

  return resolvedKeys.flatMap((key) => {
    const column = columnByKey.get(key as AdvertisingClusterSortKey);
    return column ? [column] : [];
  });
}

export function moveAdvertisingColumn(
  columns: AdvertisingClusterSortKey[],
  sourceColumn: AdvertisingClusterSortKey,
  targetColumn: AdvertisingClusterSortKey,
) {
  return moveRawColumn(columns, sourceColumn, targetColumn) as AdvertisingClusterSortKey[];
}
