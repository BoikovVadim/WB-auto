import { ui } from "../copy";
import type {
  AdvertisingClusterNumericFilterKey,
  AdvertisingClusterSortKey,
} from "./advertisingTableTypes";

export type AdvertisingColumnDefinition = {
  key: AdvertisingClusterSortKey;
  label: string;
  filterKind: "none" | "search" | "number";
};

export type AdvertisingColumnRenderKey = "select" | AdvertisingClusterSortKey;
export type AdvertisingColumnWidths = Record<AdvertisingColumnRenderKey, number>;

export const advertisingClusterTableColumns: AdvertisingColumnDefinition[] = [
  { key: "clusterName", label: ui.wbCluster, filterKind: "search" },
  { key: "productPosition", label: ui.productPosition, filterKind: "none" },
  { key: "bid", label: ui.bid, filterKind: "number" },
  { key: "spend", label: ui.spend, filterKind: "number" },
  { key: "monthlyFrequency", label: ui.frequency, filterKind: "number" },
  { key: "jamFrequency", label: ui.jamFrequency, filterKind: "number" },
  { key: "avgPosition", label: ui.avgPosition, filterKind: "number" },
  { key: "jamAvgPosition", label: ui.jamAvgPosition, filterKind: "number" },
  { key: "views", label: ui.views, filterKind: "number" },
  { key: "ctr", label: ui.ctr, filterKind: "number" },
  { key: "clicks", label: ui.clicksCount, filterKind: "number" },
  { key: "addToCart", label: ui.addToCart, filterKind: "number" },
  { key: "ctc", label: ui.ctc, filterKind: "number" },
  { key: "orders", label: ui.orders, filterKind: "number" },
  { key: "cto", label: ui.cto, filterKind: "number" },
  { key: "cpc", label: ui.cpc, filterKind: "number" },
  { key: "cpm", label: ui.cpm, filterKind: "number" },
  { key: "cpo", label: ui.cpo, filterKind: "number" },
  { key: "viewToOrder", label: ui.viewToOrder, filterKind: "number" },
  { key: "jamClicks", label: ui.jamClicks, filterKind: "number" },
  { key: "jamAddToCart", label: ui.jamAddToCart, filterKind: "number" },
  { key: "jamOrders", label: ui.jamOrders, filterKind: "number" },
  { key: "jamCtc", label: ui.jamCtc, filterKind: "number" },
  { key: "jamCto", label: ui.jamCto, filterKind: "number" },
  // Накопленные данные текущей ценовой корзины (входы движка v2) — в конце, display-only.
  { key: "accruedSpend", label: ui.accruedSpend, filterKind: "none" },
  { key: "accruedOrders", label: ui.accruedOrders, filterKind: "none" },
  { key: "accruedCpo", label: ui.accruedCpo, filterKind: "none" },
  { key: "accruedCr", label: ui.accruedCr, filterKind: "none" },
];

export const advertisingColumnOrderStorageKey = "wb-advertising-column-order-v2";

export const advertisingClusterNumericFilterKeys: AdvertisingClusterNumericFilterKey[] = [
  "jamFrequency",
  "jamClicks",
  "jamAddToCart",
  "jamOrders",
  "jamAvgPosition",
  "jamCtc",
  "jamCto",
  "monthlyFrequency",
  "bid",
  "views",
  "clicks",
  "ctr",
  "addToCart",
  "ctc",
  "orders",
  "cto",
  "avgPosition",
  "cpc",
  "cpm",
  "cpo",
  "viewToOrder",
  "spend",
];

export function isAdvertisingNumericFilterKey(
  key: AdvertisingClusterSortKey,
): key is AdvertisingClusterNumericFilterKey {
  return advertisingClusterNumericFilterKeys.includes(key as AdvertisingClusterNumericFilterKey);
}
