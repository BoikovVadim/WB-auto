import type { ProductAdvertisingWorkspaceClusterRow } from "../../../api/syncClient";
import {
  formatMoneyValue,
  formatNullableNumber,
  formatNullablePercent,
  formatPercentRatio,
} from "../formatters/metrics";
import {
  getAdvertisingMoneyPerAction,
  getAdvertisingOrderedItems,
  isClusterExcluded,
} from "./advertisingModelHelpers";
import type {
  AdvertisingColumnDefinition,
  AdvertisingColumnWidths,
} from "./advertisingClusterTableColumns";
import type { AdvertisingClusterSortKey } from "./advertisingTableTypes";

export function buildAdvertisingClusterWidths(
  rows: ProductAdvertisingWorkspaceClusterRow[],
  columns: AdvertisingColumnDefinition[],
): AdvertisingColumnWidths {
  const sampledRows =
    rows.length > 40
      ? rows.slice(0, 40)
      : rows;
  const widths: AdvertisingColumnWidths = {
    select: 28,
    source: 42,
    advertId: 72,
    campaignName: 140,
    clusterName: 188,
    jamFrequency: 110,
    jamClicks: 96,
    jamAddToCart: 106,
    jamOrders: 96,
    jamAvgPosition: 112,
    jamCtc: 116,
    jamCto: 116,
    monthlyFrequency: 96,
    bid: 72,
    views: 72,
    clicks: 72,
    ctr: 72,
    addToCart: 72,
    ctc: 72,
    orders: 72,
    cto: 72,
    avgPosition: 92,
    cpc: 72,
    cpm: 72,
    cpo: 84,
    viewToOrder: 92,
    spend: 90,
  };

  for (const column of columns) {
    const headerWidth = measureAdvertisingTextWidth(column.label, "700 9px system-ui") + 28;
    const minFilterWidth =
      column.filterKind === "search" ? 140 : column.filterKind === "number" ? 64 : 0;

    if (column.key === "clusterName") {
      widths[column.key] = Math.ceil(Math.max(widths[column.key], headerWidth, minFilterWidth));
      continue;
    }

    let maxCellWidth = 0;
    for (const row of sampledRows) {
      const cellText =
        column.key === "source"
          ? formatAdvertisingStatusIndicatorBaseLabel(row)
          : formatAdvertisingColumnValue(row, column.key);
      maxCellWidth = Math.max(
        maxCellWidth,
        measureAdvertisingTextWidth(cellText, "700 8px system-ui") +
          getAdvertisingColumnPadding(column.key),
      );
    }

    widths[column.key] = Math.ceil(
      Math.max(widths[column.key], headerWidth, minFilterWidth, maxCellWidth),
    );
  }

  return widths;
}

function formatAdvertisingColumnValue(
  row: ProductAdvertisingWorkspaceClusterRow,
  key: AdvertisingClusterSortKey,
) {
  if (key === "bid") {
    return formatNullableNumber(row.bid);
  }
  if (key === "jamFrequency") {
    return formatNullableNumber(row.jamFrequency);
  }
  if (key === "jamClicks") {
    return formatNullableNumber(row.jamClicks);
  }
  if (key === "jamAddToCart") {
    return formatNullableNumber(row.jamAddToCart);
  }
  if (key === "jamOrders") {
    return formatNullableNumber(row.jamOrders);
  }
  if (key === "jamAvgPosition") {
    return formatNullableNumber(row.jamAvgPosition);
  }
  if (key === "jamCtc") {
    return formatPercentRatio(row.jamAddToCart, row.jamClicks);
  }
  if (key === "jamCto") {
    return formatPercentRatio(row.jamOrders, row.jamAddToCart);
  }
  if (key === "monthlyFrequency") {
    return formatNullableNumber(row.monthlyFrequency);
  }
  if (key === "views") {
    return formatNullableNumber(row.views);
  }
  if (key === "clicks") {
    return formatNullableNumber(row.clicks);
  }
  if (key === "ctr") {
    return formatNullablePercent(row.ctr);
  }
  if (key === "addToCart") {
    return formatNullableNumber(row.addToCart);
  }
  if (key === "ctc") {
    return formatPercentRatio(row.addToCart, row.clicks);
  }
  if (key === "orders") {
    return formatNullableNumber(getAdvertisingOrderedItems(row));
  }
  if (key === "cto") {
    return formatPercentRatio(getAdvertisingOrderedItems(row), row.addToCart);
  }
  if (key === "avgPosition") {
    return formatNullableNumber(row.avgPosition);
  }
  if (key === "cpc") {
    return formatNullableNumber(row.cpc);
  }
  if (key === "cpm") {
    return formatNullableNumber(row.cpm);
  }
  if (key === "cpo") {
    return formatMoneyValue(
      getAdvertisingMoneyPerAction(row.spend, getAdvertisingOrderedItems(row)),
      row.currency,
    );
  }
  if (key === "viewToOrder") {
    return formatPercentRatio(getAdvertisingOrderedItems(row), row.views);
  }
  if (key === "spend") {
    return formatMoneyValue(row.spend, row.currency);
  }
  if (key === "clusterName") {
    return row.clusterName;
  }
  if (key === "source") {
    return formatAdvertisingStatusIndicatorBaseLabel(row);
  }

  return "";
}

function getAdvertisingColumnPadding(key: AdvertisingClusterSortKey) {
  if (key === "clusterName") {
    return 34;
  }
  if (key === "source") {
    return 18;
  }

  return 16;
}

let advertisingMeasureCanvas: HTMLCanvasElement | null = null;

function measureAdvertisingTextWidth(text: string, font: string) {
  if (typeof document === "undefined") {
    return text.length * 7;
  }

  if (!advertisingMeasureCanvas) {
    advertisingMeasureCanvas = document.createElement("canvas");
  }

  const context = advertisingMeasureCanvas.getContext("2d");
  if (!context) {
    return text.length * 7;
  }

  context.font = font;
  return context.measureText(text).width;
}

function formatAdvertisingStatusIndicatorBaseLabel(row: ProductAdvertisingWorkspaceClusterRow) {
  return isClusterExcluded(row) ? "Неактивен" : "Активен";
}
