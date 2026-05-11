export type ProductAdvertisingSourceKind =
  | "active"
  | "excluded"
  | "stats"
  | "query-map";
export type ProductAdvertisingBidSyncStatus =
  | "queued"
  | "sending"
  | "pending"
  | "throttled"
  | "confirmed"
  | "failed";
export type ProductAdvertisingActionSyncStatus =
  | "queued"
  | "sending"
  | "throttled"
  | "confirmed"
  | "failed";
export type ProductAdvertisingBidJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "retry_scheduled";
export type ProductAdvertisingActionJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "retry_scheduled";

export interface ProductAdvertisingCampaign {
  advertId: number;
  campaignType: number;
  campaignStatus: number;
  paymentType: string | null;
  bidType: string | null;
  currency: string | null;
  name: string | null;
  subjectId: number | null;
  subjectName: string | null;
  changeTime: string | null;
  createdAtWb: string | null;
  startedAtWb: string | null;
  updatedAtWb: string | null;
  syncedAt: string | null;
}

export interface ProductAdvertisingCluster {
  advertId: number | null;
  campaignName: string | null;
  campaignType: number | null;
  campaignStatus: number | null;
  paymentType: string | null;
  bidType: string | null;
  currency: string | null;
  clusterName: string;
  canonicalNormQuery: string;
  sourceKind: ProductAdvertisingSourceKind;
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
  bidSyncStatus: ProductAdvertisingBidSyncStatus | null;
  bidConfirmedAt: string | null;
  bidRetryAt: string | null;
  bidLastError: string | null;
  actionSyncStatus: ProductAdvertisingActionSyncStatus | null;
  actionRetryAt: string | null;
  actionLastError: string | null;
  queryCount: number | null;
  jamQueryCount: number | null;
  jamFrequency: number | null;
  jamClicks: number | null;
  jamAddToCart: number | null;
  jamOrders: number | null;
  jamAvgPosition: number | null;
  monthlyFrequency: number | null;
  updatedAt: string | null;
}

export type ProductAdvertisingClusterQuerySource =
  | "cluster-name"
  | "frequency-backed"
  | "stats"
  | "query-map"
  | "soft-match"
  | "cabinet-private-api";

export type ProductAdvertisingClusterQueryMappingSource =
  | "promotion"
  | "cabinet"
  | "merged"
  | "cluster-name";

export type ProductAdvertisingClusterQueryMatchConfidence =
  | "exact"
  | "trusted-source"
  | "frequency-backed"
  | "stats-backed"
  | "soft-match";

export interface ProductAdvertisingClusterQuery {
  advertId: number;
  clusterName: string;
  queryText: string;
  querySource: ProductAdvertisingClusterQuerySource;
  mappingSource: ProductAdvertisingClusterQueryMappingSource;
  matchConfidence: ProductAdvertisingClusterQueryMatchConfidence;
  isFrequencyBacked: boolean;
  isClusterConfirmed: boolean;
  isCanonicalClusterQuery: boolean;
  isCabinetBacked: boolean;
  cabinetSnapshotAt: string | null;
  sourceKind: ProductAdvertisingSourceKind;
  isActive: boolean | null;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  addToCart: number | null;
  shks: number | null;
  jamFrequency: number | null;
  jamClicks: number | null;
  jamAddToCart: number | null;
  jamOrders: number | null;
  jamAvgPosition: number | null;
  jamOpenToCart: number | null;
  monthlyFrequency: number | null;
  updatedAt: string | null;
}

export interface ProductAdvertisingDailyStat {
  advertId: number;
  date: string;
  clusterName: string;
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
  currency: string | null;
  updatedAt: string | null;
}

export interface ProductAdvertisingMinusPhrase {
  advertId: number;
  phrase: string;
  updatedAt: string | null;
}

export interface ProductAdvertisingKeywordStat {
  advertId: number;
  date: string;
  keyword: string;
  views: number | null;
  clicks: number | null;
  ctr: number | null;
  spend: number | null;
  currency: string | null;
  updatedAt: string | null;
}
