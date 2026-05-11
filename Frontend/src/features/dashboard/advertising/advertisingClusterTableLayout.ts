import type {
  AdvertisingColumnDefinition,
  AdvertisingColumnRenderKey,
  AdvertisingColumnWidths,
} from "./clusterTableView";

export function ratio(numerator: number | null, denominator: number | null) {
  if (
    numerator === null ||
    denominator === null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }

  return numerator / denominator;
}

export function getStickyOffsets(
  advertisingColumnWidths: AdvertisingColumnWidths,
  orderedAdvertisingColumns: AdvertisingColumnDefinition[],
) {
  const renderOrder: AdvertisingColumnRenderKey[] = [
    "select",
    ...orderedAdvertisingColumns.map((column) => column.key),
  ];
  const bidIndex = renderOrder.indexOf("bid");
  const offsets: Partial<Record<AdvertisingColumnRenderKey, number>> = {};

  if (bidIndex === -1) {
    return offsets;
  }

  let currentLeft = 0;
  for (const key of renderOrder.slice(0, bidIndex + 1)) {
    offsets[key] = currentLeft;
    currentLeft += advertisingColumnWidths[key];
  }

  return offsets;
}

export function getAdvertisingStickyStyle(
  stickyOffsets: Partial<Record<AdvertisingColumnRenderKey, number>>,
  columnKey: AdvertisingColumnRenderKey,
) {
  const left = stickyOffsets[columnKey];
  if (typeof left !== "number") {
    return undefined;
  }

  return { left: `${String(left)}px` };
}

export function getAdvertisingCellClassName(
  stickyOffsets: Partial<Record<AdvertisingColumnRenderKey, number>>,
  columnKey: AdvertisingColumnRenderKey,
  options?: { header?: boolean; dragging?: boolean },
) {
  const classNames: string[] = [];

  if (options?.header) {
    classNames.push("wb-data-table__header-cell");
  } else if (columnKey !== "select" && columnKey !== "clusterName") {
    classNames.push("wb-table-cell--numeric");
  }

  if (columnKey === "clusterName") {
    classNames.push(
      "wb-advertising-column-cell",
      "wb-advertising-column-cell--cluster",
    );
  }

  if (typeof stickyOffsets[columnKey] === "number") {
    classNames.push("wb-advertising-column--sticky");
  }

  if (options?.dragging) {
    classNames.push("wb-advertising-column--dragging");
  }

  return classNames.join(" ");
}
