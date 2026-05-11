export type AdvertisingClusterStatusFilter = "all" | "active" | "excluded";

export type AdvertisingClusterSortKey =
  | "source"
  | "advertId"
  | "campaignName"
  | "clusterName"
  | "jamFrequency"
  | "jamClicks"
  | "jamAddToCart"
  | "jamOrders"
  | "jamAvgPosition"
  | "jamCtc"
  | "jamCto"
  | "monthlyFrequency"
  | "bid"
  | "views"
  | "clicks"
  | "ctr"
  | "addToCart"
  | "ctc"
  | "orders"
  | "cto"
  | "avgPosition"
  | "cpc"
  | "cpm"
  | "cpo"
  | "viewToOrder"
  | "spend";

export type AdvertisingClusterSortDirection = "asc" | "desc";

export type AdvertisingClusterNumericFilterKey =
  | "jamFrequency"
  | "jamClicks"
  | "jamAddToCart"
  | "jamOrders"
  | "jamAvgPosition"
  | "jamCtc"
  | "jamCto"
  | "monthlyFrequency"
  | "bid"
  | "views"
  | "clicks"
  | "ctr"
  | "addToCart"
  | "ctc"
  | "orders"
  | "cto"
  | "avgPosition"
  | "cpc"
  | "cpm"
  | "cpo"
  | "viewToOrder"
  | "spend";

export type AdvertisingClusterNumericFilters = Record<
  AdvertisingClusterNumericFilterKey,
  {
    min: string;
    max: string;
  }
>;
