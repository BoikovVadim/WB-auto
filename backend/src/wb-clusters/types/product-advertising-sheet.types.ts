import type {
  ClusterActionSyncStatus,
  ClusterBidSyncStatus,
  ClusterSourceKind,
} from "./core.types";

export interface ProductAdvertisingCampaign {
  advertId: number;
  campaignType: number;
  campaignStatus: number;
  paymentType: string | null;
  bidType: string | null;
  placementsSearch: boolean | null;
  placementsRecommendations: boolean | null;
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
  sourceKind: ClusterSourceKind;
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
  bidSyncStatus: ClusterBidSyncStatus | null;
  bidConfirmedAt: string | null;
  bidRetryAt: string | null;
  bidLastError: string | null;
  actionSyncStatus: ClusterActionSyncStatus | null;
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

export type ProductAdvertisingQueryCoverageStatus =
  | "no-clusters"
  | "missing-query-map"
  | "partial"
  | "ready";

export type ProductAdvertisingDailyStatsCoverageStatus =
  | "not_requested"
  | "full"
  | "partial"
  | "missing";

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
  sourceKind: ClusterSourceKind;
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

export type ProductAdvertisingJamMaterializationStatus =
  | "not_requested"
  | "pending"
  | "ready";

export type ProductAdvertisingPeriodMetricsStatus =
  | "exact"
  | "partial"
  | "unavailable";

export type ProductAdvertisingSnapshotStatus = "ready" | "building" | "failed" | "missing";

export type ProductAdvertisingSnapshotFit =
  | "exact"
  | "latest_schema"
  | "closest_range"
  | "most_recent"
  | "live_read_model"
  | "unavailable";

export type ProductAdvertisingSnapshotSource =
  | "exact_snapshot"
  | "latest_schema_snapshot"
  | "closest_range_snapshot"
  | "most_recent_snapshot"
  | "live_read_model"
  | "snapshot_store";

export interface ProductAdvertisingSheetResponse {
  nmId: number;
  checkedAt: string;
  snapshot: {
    status: ProductAdvertisingSnapshotStatus;
    fit: ProductAdvertisingSnapshotFit;
    source: ProductAdvertisingSnapshotSource;
    builtAt: string | null;
    requestedStartDate: string | null;
    requestedEndDate: string | null;
    snapshotStartDate: string | null;
    snapshotEndDate: string | null;
    builtFromExportRequestId: string | null;
    lastError: string | null;
  };
  range: {
    startDate: string | null;
    endDate: string | null;
    jamIncluded: boolean;
    jamStatus: ProductAdvertisingJamMaterializationStatus;
  };
  summary: {
    campaignsCount: number;
    clustersCount: number;
    clusterQueriesCount: number;
    dailyStatsCount: number;
    minusPhrasesCount: number;
    keywordStatsCount: number;
    queryCoverageStatus: ProductAdvertisingQueryCoverageStatus;
    queryCoverageReason: string | null;
    dailyStatsCoverageStatus: ProductAdvertisingDailyStatsCoverageStatus;
    dailyStatsCoverageReason: string | null;
    dailyStatsWindowStartDate: string | null;
    dailyStatsWindowEndDate: string | null;
    periodMetricsStatus: ProductAdvertisingPeriodMetricsStatus;
    periodMetricsReason: string | null;
    periodMetricsActualStartDate: string | null;
    periodMetricsActualEndDate: string | null;
  };
  campaigns: ProductAdvertisingCampaign[];
  clusters: ProductAdvertisingCluster[];
  clusterQueries: ProductAdvertisingClusterQuery[];
  dailyStats: ProductAdvertisingDailyStat[];
  minusPhrases: ProductAdvertisingMinusPhrase[];
  keywordStats: ProductAdvertisingKeywordStat[];
}

export interface ProductAdvertisingSheetBundleResponse {
  checkedAt: string;
  range: {
    startDate: string;
    endDate: string;
  };
  sheets: ProductAdvertisingSheetResponse[];
}
