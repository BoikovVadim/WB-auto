import type {
  ProductAdvertisingCampaign,
  ProductAdvertisingCluster,
  ProductAdvertisingClusterQuery,
  ProductAdvertisingDailyStat,
  ProductAdvertisingKeywordStat,
  ProductAdvertisingMinusPhrase,
} from "./syncClientAdvertisingSheetEntityTypes";

export type ProductAdvertisingJamMaterializationStatus =
  | "not_requested"
  | "pending"
  | "ready";

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

export type ProductAdvertisingDailyStatsCoverageStatus =
  | "not_requested"
  | "full"
  | "partial"
  | "missing";

export type ProductAdvertisingQueryCoverageStatus =
  | "no-clusters"
  | "missing-query-map"
  | "partial"
  | "ready";

export type ProductAdvertisingPeriodMetricsStatus =
  | "exact"
  | "partial"
  | "unavailable";

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
