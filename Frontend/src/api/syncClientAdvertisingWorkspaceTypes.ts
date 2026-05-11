import type {
  ProductAdvertisingCluster,
  ProductAdvertisingClusterQuery,
  ProductAdvertisingSheetResponse,
} from "./syncClientAdvertisingSheetTypes";

export interface ProductAdvertisingWorkspaceCampaignTotals {
  spend: number | null;
  orders: number | null;
  clicks: number | null;
  views: number | null;
  addToCart: number | null;
  ctr: number | null;
  ctc: number | null;
  cto: number | null;
  cpc: number | null;
  cpm: number | null;
  cpo: number | null;
  viewToOrder: number | null;
  activeCount: number;
  excludedCount: number;
}

export interface ProductAdvertisingWorkspaceCampaignTab {
  advertId: number;
  campaignName: string | null;
  campaignStatus: number | null;
  paymentType: string | null;
  bidType: string | null;
  currency: string | null;
  syncedAt: string | null;
  rowsCount: number;
  totals: ProductAdvertisingWorkspaceCampaignTotals;
}

export type ProductAdvertisingWorkspaceReadinessScope =
  | "workspace"
  | "cluster_table"
  | "cluster_queries";

export type ProductAdvertisingWorkspaceReadinessStatus =
  | "ready"
  | "materialization_pending";

export type ProductAdvertisingWorkspaceReadinessSource =
  | "workspace_snapshot"
  | "sheet_snapshot"
  | "sql_direct";

export type ProductAdvertisingWorkspaceMaterializationStatus =
  | "materialized"
  | "fallback_sheet"
  | "sql_direct"
  | "pending";

export interface ProductAdvertisingWorkspaceReadiness {
  scope: ProductAdvertisingWorkspaceReadinessScope;
  status: ProductAdvertisingWorkspaceReadinessStatus;
  source: ProductAdvertisingWorkspaceReadinessSource;
  materializationStatus: ProductAdvertisingWorkspaceMaterializationStatus;
}

export interface ProductAdvertisingWorkspaceResponse {
  nmId: number;
  checkedAt: string;
  readiness: ProductAdvertisingWorkspaceReadiness;
  header: {
    nmId: number;
    vendorCode: string | null;
    productName: string | null;
    brandName: string | null;
    subjectName: string | null;
  };
  snapshot: ProductAdvertisingSheetResponse["snapshot"];
  range: ProductAdvertisingSheetResponse["range"];
  dateBounds: {
    minDate: string | null;
    maxDate: string | null;
    defaultStartDate: string | null;
    defaultEndDate: string | null;
  };
  campaignTabs: ProductAdvertisingWorkspaceCampaignTab[];
  defaultCampaignId: number | null;
  selectedCampaignSummary: ProductAdvertisingWorkspaceCampaignTab | null;
  initialClusterTable: ProductAdvertisingWorkspaceClusterTableResponse | null;
  syncState: {
    hasPendingClusterSync: boolean;
    refreshStatus: "idle" | "running";
    syncRunId: string | null;
    startedAt: string | null;
  };
  diagnostics: {
    periodMetricsStatus: ProductAdvertisingSheetResponse["summary"]["periodMetricsStatus"];
    periodMetricsActualStartDate: string | null;
    periodMetricsActualEndDate: string | null;
    dailyStatsWindowStartDate: string | null;
    dailyStatsWindowEndDate: string | null;
    queryCoverageStatus: ProductAdvertisingSheetResponse["summary"]["queryCoverageStatus"];
  };
}

export type ProductAdvertisingWorkspaceClusterStatusFilter = "all" | "active" | "excluded";
export type ProductAdvertisingWorkspaceClusterSortDirection = "asc" | "desc";
export type ProductAdvertisingWorkspaceClusterSortKey =
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

export type ProductAdvertisingWorkspaceClusterNumericFilterKey =
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

export type ProductAdvertisingWorkspaceClusterNumericFilters = Record<
  ProductAdvertisingWorkspaceClusterNumericFilterKey,
  {
    min: number | null;
    max: number | null;
  }
>;

export interface ProductAdvertisingWorkspaceClusterRow {
  clusterKey: string;
  advertId: number | null;
  campaignName: string | null;
  campaignType: number | null;
  campaignStatus: number | null;
  paymentType: string | null;
  bidType: string | null;
  currency: string | null;
  clusterName: string;
  canonicalNormQuery: string;
  queryCount: number | null;
  jamQueryCount: number | null;
  jamFrequency: number | null;
  jamClicks: number | null;
  jamAddToCart: number | null;
  jamOrders: number | null;
  jamAvgPosition: number | null;
  monthlyFrequency: number | null;
  sourceKind: ProductAdvertisingCluster["sourceKind"];
  isActive: boolean | null;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  addToCart: number | null;
  shks: number | null;
  ctr: number | null;
  avgPosition: number | null;
  cpc: number | null;
  cpm: number | null;
  spend: number | null;
  bid: number | null;
  bidSyncStatus: ProductAdvertisingCluster["bidSyncStatus"];
  bidConfirmedAt: string | null;
  bidRetryAt: string | null;
  bidLastError: string | null;
  actionSyncStatus: ProductAdvertisingCluster["actionSyncStatus"];
  actionRetryAt: string | null;
  actionLastError: string | null;
  updatedAt: string | null;
}

export interface ProductAdvertisingWorkspaceClusterTableTotals {
  count: number;
  jamQueryCount: number | null;
  jamFrequency: number | null;
  jamClicks: number | null;
  jamAddToCart: number | null;
  jamOrders: number | null;
  jamAvgPosition: number | null;
  monthlyFrequency: number | null;
  bid: number | null;
  views: number | null;
  clicks: number | null;
  ctr: number | null;
  addToCart: number | null;
  ctc: number | null;
  orders: number | null;
  cto: number | null;
  avgPosition: number | null;
  cpc: number | null;
  cpm: number | null;
  cpo: number | null;
  viewToOrder: number | null;
  spend: number | null;
  currency: string | null;
}

export interface ProductAdvertisingWorkspaceClusterTableResponse {
  nmId: number;
  advertId: number;
  checkedAt: string;
  readiness: ProductAdvertisingWorkspaceReadiness;
  rows: ProductAdvertisingWorkspaceClusterRow[];
  querySearchIndex: Record<string, string[]>;
  totals: ProductAdvertisingWorkspaceClusterTableTotals;
  totalsScope: "filtered_population";
  filterCounts: {
    all: number;
    active: number;
    excluded: number;
  };
  appliedFilters: {
    search: string;
    status: ProductAdvertisingWorkspaceClusterStatusFilter;
    numericFilters: ProductAdvertisingWorkspaceClusterNumericFilters;
  };
  sort: {
    key: ProductAdvertisingWorkspaceClusterSortKey;
    direction: ProductAdvertisingWorkspaceClusterSortDirection;
  };
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
}

export interface ProductAdvertisingWorkspaceBundleResponse {
  workspace: ProductAdvertisingWorkspaceResponse;
  clusterTables: Record<string, ProductAdvertisingWorkspaceClusterTableResponse>;
}

export interface ProductAdvertisingWorkspaceClusterQueriesResponse {
  nmId: number;
  advertId: number;
  clusterKey: string;
  clusterName: string;
  checkedAt: string;
  readiness: ProductAdvertisingWorkspaceReadiness;
  queries: ProductAdvertisingClusterQuery[];
  sort: {
    key: ProductAdvertisingWorkspaceClusterSortKey;
    direction: ProductAdvertisingWorkspaceClusterSortDirection;
  };
}
