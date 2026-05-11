import type {
  ProductAdvertisingBidSyncStatus,
  ProductAdvertisingSheetResponse,
} from "../../../api/syncClient";

export type AdvertisingClusterRow = {
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
  sourceKind: ProductAdvertisingSheetResponse["clusters"][number]["sourceKind"];
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
  bidSyncStatus: ProductAdvertisingSheetResponse["clusters"][number]["bidSyncStatus"];
  bidConfirmedAt: string | null;
  bidRetryAt: string | null;
  bidLastError: string | null;
  actionSyncStatus: ProductAdvertisingSheetResponse["clusters"][number]["actionSyncStatus"];
  actionRetryAt: string | null;
  actionLastError: string | null;
  updatedAt: string | null;
};

export type AdvertisingCampaignSummary = {
  advertId: number;
  campaignName: string | null;
  campaignStatus: number | null;
  paymentType: string | null;
  bidType: string | null;
  currency: string | null;
  syncedAt: string | null;
  rows: AdvertisingClusterRow[];
  totals: {
    spend: number;
    orders: number;
    clicks: number;
    views: number;
    activeCount: number;
    excludedCount: number;
  };
};

export type AdvertisingClusterQueryRow = {
  advertId: number;
  queryText: string;
  querySource: ProductAdvertisingSheetResponse["clusterQueries"][number]["querySource"];
  mappingSource: ProductAdvertisingSheetResponse["clusterQueries"][number]["mappingSource"];
  matchConfidence: ProductAdvertisingSheetResponse["clusterQueries"][number]["matchConfidence"];
  isFrequencyBacked: boolean;
  isClusterConfirmed: boolean;
  isCanonicalClusterQuery: boolean;
  isCabinetBacked: boolean;
  cabinetSnapshotAt: string | null;
  jamFrequency: number | null;
  jamClicks: number | null;
  jamAddToCart: number | null;
  jamOrders: number | null;
  jamAvgPosition: number | null;
  jamOpenToCart: number | null;
  monthlyFrequency: number | null;
  sourceKind: ProductAdvertisingSheetResponse["clusterQueries"][number]["sourceKind"];
  isActive: boolean | null;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  addToCart: number | null;
  shks: number | null;
  updatedAt: string | null;
};

export type AdvertisingClusterGroup = {
  key: string;
  clusterName: string;
  row: AdvertisingClusterRow;
  queries: AdvertisingClusterQueryRow[];
};

export type AdvertisingClusterBidSyncStatus = ProductAdvertisingBidSyncStatus;
