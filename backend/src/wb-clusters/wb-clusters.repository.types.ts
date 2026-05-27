import type { SearchQueryTextView } from "../wb-sync/wb-sync.types";
import type {
  ClusterActionJobStatus,
  ClusterActionSyncStatus,
  ClusterBidSyncStatus,
  ClusterBidJobStatus,
  ClusterSourceKind,
  ClusterSyncStatus,
  ClusterSyncTrigger,
  ProductAdvertisingClusterQueryMappingSource,
  ProductAdvertisingQueryCoverageStatus,
  ProductPresetSnapshotJobStatus,
  PromotionCampaignCountResponse,
  ProductAdvertisingSheetResponse,
} from "./wb-clusters.types";

export interface ClusterSyncRunRecord {
  id: string;
  trigger: ClusterSyncTrigger;
  status: ClusterSyncStatus;
  started_at: string;
  finished_at: string | null;
  campaigns_seen: number;
  campaigns_synced: number;
  products_seen: number;
  clusters_upserted: number;
  stats_rows_upserted: number;
  warning_count: number;
  has_partial_failure: boolean;
  error_message: string | null;
}

export interface ClusterBidJobRecord {
  job_id: string;
  advert_id: string;
  nm_id: string;
  status: ClusterBidJobStatus;
  processing_phase: "write" | "reconcile";
  attempt_count: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClusterActionJobRecord {
  job_id: string;
  advert_id: string;
  nm_id: string;
  status: ClusterActionJobStatus;
  attempt_count: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductPresetSnapshotJobRecord {
  job_id: string;
  source_export_request_id: string;
  preset_export_request_id: string | null;
  requested_start_date: string;
  requested_end_date: string;
  status: ProductPresetSnapshotJobStatus;
  attempt_count: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  last_error: string | null;
  reason: string | null;
  nm_ids_json: number[];
  created_at: string;
  updated_at: string;
}

export interface StoredCampaignInventoryRow {
  advert_id: string;
  campaign_type: number;
  campaign_status: number;
  payment_type: string | null;
  bid_type: string | null;
  currency: string | null;
  name: string | null;
  change_time: string | null;
  created_at_wb: string | null;
  started_at_wb: string | null;
  updated_at_wb: string | null;
  nm_id: string | null;
  subject_id: number | null;
  subject_name: string | null;
  search_bid: string | null;
  min_search_bid: string | null;
}

export interface StoredProductSearchTextRangeSnapshotRow {
  snapshot_key: string;
  row_count: number;
  synced_at: string;
}

export interface StoredProductAdvertisingSheetSnapshotRow {
  nm_id?: string;
  payload: ProductAdvertisingSheetResponse;
  start_date: string;
  end_date: string;
  schema_version: number;
  status: string;
  built_from_export_request_id: string | null;
  source_kind: string;
  ready_at: string | null;
  last_attempt_at: string | null;
  failure_reason: string | null;
  synced_at: string;
}

export interface StoredProductCatalogRow {
  nm_id: string;
  vendor_code: string;
  product_name: string;
  brand_name: string;
  subject_name: string;
  subject_id: string | null;
  category_name: string | null;
  source_export_request_id: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  synced_at: string;
}

export interface ProductAdvertisingSnapshotSummaryRow {
  nm_id: string;
  start_date: string;
  end_date: string;
  schema_version: number;
  status: string;
  built_from_export_request_id: string | null;
  ready_at: string | null;
  failure_reason: string | null;
  synced_at: string;
}

export interface PreferredProductAdvertisingSnapshotSummaryRow
  extends ProductAdvertisingSnapshotSummaryRow {
  resolution_fit: "exact" | "latest_schema" | "closest_range" | "most_recent";
  resolution_source:
    | "exact_snapshot"
    | "latest_schema_snapshot"
    | "closest_range_snapshot"
    | "most_recent_snapshot";
}

export interface StoredProductAdvertisingSheetSnapshotRecord {
  nmId: number;
  payload: ProductAdvertisingSheetResponse;
  startDate: string;
  endDate: string;
  schemaVersion: number;
  status: string;
  builtFromExportRequestId: string | null;
  sourceKind: string;
  readyAt: string | null;
  lastAttemptAt: string | null;
  failureReason: string | null;
  syncedAt: string;
}

export interface ProductAdvertisingSnapshotSummaryRecord {
  nmId: number;
  startDate: string;
  endDate: string;
  schemaVersion: number;
  status: string;
  builtFromExportRequestId: string | null;
  readyAt: string | null;
  failureReason: string | null;
  syncedAt: string;
}

export interface PreferredProductAdvertisingSnapshotSummaryRecord
  extends ProductAdvertisingSnapshotSummaryRecord {
  fit: "exact" | "latest_schema" | "closest_range" | "most_recent";
  source:
    | "exact_snapshot"
    | "latest_schema_snapshot"
    | "closest_range_snapshot"
    | "most_recent_snapshot";
}

export interface ProductPresetSnapshotJobRecordSummary {
  jobId: string;
  sourceExportRequestId: string;
  presetExportRequestId: string | null;
  startDate: string;
  endDate: string;
  status: ProductPresetSnapshotJobStatus;
  attemptCount: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  lastError: string | null;
  reason: string | null;
  nmIds: number[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredProductSearchTextRangeRow {
  query_text: string;
  frequency: string | null;
  week_frequency: string | null;
  avg_position_current: string | null;
  avg_position_dynamics: string | null;
  orders_current: string | null;
  orders_dynamics: string | null;
  open_card_current: string | null;
  open_card_dynamics: string | null;
  add_to_cart_current: string | null;
  add_to_cart_dynamics: string | null;
  open_to_cart_current: string | null;
  open_to_cart_dynamics: string | null;
}

export interface StoredProductAdvertisingMutationContext {
  campaign: {
    advertId: number;
    paymentType: string | null;
    bidType: string | null;
  } | null;
  clusters: Array<{
    clusterName: string;
    normalizedClusterName: string;
    canonicalNormQuery: string;
    sourceKind: ClusterSourceKind;
    isActive: boolean | null;
  }>;
}

export interface RawArchivePayloadRow {
  payload: PromotionCampaignCountResponse;
}

export interface RawAdvertisingSheetClusterRow {
  advertId: number | null;
  campaignName: string | null;
  campaignType: number | null;
  campaignStatus: number | null;
  paymentType: string | null;
  bidType: string | null;
  currency: string | null;
  clusterName: string;
  normalizedClusterName: string;
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
  monthlyFrequency: number | null;
  updatedAt: string | null;
}

export interface RawAdvertisingSheetClusterQueryRow {
  advertId: number;
  clusterName: string;
  normalizedClusterName: string;
  queryText: string;
  normalizedQueryText: string;
  mappingSource: ProductAdvertisingClusterQueryMappingSource;
  isCabinetBacked: boolean;
  cabinetSnapshotAt: string | null;
  sourceKind: ClusterSourceKind;
  isActive: boolean | null;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  addToCart: number | null;
  shks: number | null;
  monthlyFrequency: number | null;
  updatedAt: string | null;
}

export interface CanonicalClusterDescriptor {
  advertId: number;
  clusterName: string;
  normalizedClusterName: string;
  normalizedIdentity: string;
  tokenStems: string[];
  /** Pre-computed Set<tokenStem> — avoids repeated `new Set(tokenStems)` in hot loops. */
  tokenStemSet: Set<string>;
  hasLatinOrDigitToken: boolean;
}

export interface ProductAdvertisingQueryCoverageSummary {
  clusterQueriesCount: number;
  queryCoverageStatus: ProductAdvertisingQueryCoverageStatus;
  queryCoverageReason: string | null;
}

export type StoredProductSearchTextRangeRecord = SearchQueryTextView[] | null;
