import {
  cacheExportHistory,
  cacheExportMethods,
  cacheExportResponse,
} from "./exportCache";
import { cacheProductCatalogResponse } from "./productCatalogCache";
import type { SyncEntity } from "./syncClientTypes";
import {
  assertExportHistoryResponse,
  assertExportJobResponse,
  assertExportMethodsResponse,
  assertExportResponse,
  assertHealthResponse,
  assertIntegrationStatusResponse,
  assertProductCatalogResponse,
  assertSyncPreviewResponse,
  assertTokenSessionResponse,
  isProductSearchTextsRangeResponse,
} from "./syncClientValidators";
import { advertisingApiTimeoutMs, apiClient } from "./syncClientHttp";

export async function fetchHealth() {
  const response = await apiClient.get<unknown>("/health");
  assertHealthResponse(response.data);
  return response.data;
}

export async function fetchIntegrationStatus() {
  const response = await apiClient.get<unknown>("/wb-sync/status");
  assertIntegrationStatusResponse(response.data);
  return response.data;
}

export async function fetchTokenSession() {
  const response = await apiClient.get<unknown>("/wb-sync/token");
  assertTokenSessionResponse(response.data);
  return response.data;
}

export async function fetchExportMethods() {
  const response = await apiClient.get<unknown>("/wb-sync/methods");
  assertExportMethodsResponse(response.data);
  cacheExportMethods(response.data);
  return response.data;
}

export async function saveRuntimeToken(token: string) {
  const response = await apiClient.post<unknown>("/wb-sync/token", { token });
  assertTokenSessionResponse(response.data);
  return response.data;
}

export async function clearRuntimeToken() {
  const response = await apiClient.delete<unknown>("/wb-sync/token");
  assertTokenSessionResponse(response.data);
  return response.data;
}

export async function previewSync(entityType: SyncEntity) {
  const response = await apiClient.post<unknown>("/wb-sync/jobs/preview", {
    entityType,
  });
  assertSyncPreviewResponse(response.data);
  return response.data;
}

export async function exportWbData(params: {
  entityType: SyncEntity;
  locale?: string;
  customPayload?: Record<string, unknown>;
}) {
  const response = await apiClient.post<unknown>("/wb-sync/exports", params);
  assertExportJobResponse(response.data);
  return response.data;
}

export async function fetchExportStatus(requestId: string) {
  const response = await apiClient.get<unknown>(`/wb-sync/exports/${requestId}/status`);
  assertExportJobResponse(response.data);
  return response.data;
}

export async function fetchExportHistory() {
  const response = await apiClient.get<unknown>("/wb-sync/exports/history");
  assertExportHistoryResponse(response.data);
  cacheExportHistory(response.data);
  return response.data;
}

export async function fetchProductCatalog() {
  const response = await apiClient.get<unknown>("/wb-clusters/products/catalog");
  assertProductCatalogResponse(response.data);
  cacheProductCatalogResponse(response.data);
  return response.data;
}

export async function fetchSavedExport(requestId: string) {
  const response = await apiClient.get<unknown>(`/wb-sync/exports/${requestId}`);
  assertExportResponse(response.data);
  await cacheExportResponse(response.data);
  return response.data;
}

export type JamBackfillQueueItem = {
  position: number;
  group: "active_rk" | "no_rk";
  nmId: number;
  vendorCode: string | null;
  productName: string | null;
  daysFilled: number;
  daysEmpty: number;
  daysTotal: number;
  isComplete: boolean;
};

export async function fetchJamBackfillQueue(): Promise<JamBackfillQueueItem[]> {
  const response = await apiClient.get<unknown>("/wb-clusters/jam/backfill-queue");
  if (!Array.isArray(response.data)) {
    throw new Error("Invalid JAM backfill queue response.");
  }
  return response.data as JamBackfillQueueItem[];
}

export type RawJamRow = {
  snapshotKey: string;
  nmId: number;
  startDate: string;
  endDate: string;
  queryText: string;
  normalizedQueryText: string;
  frequency: number | null;
  weekFrequency: number | null;
  avgPositionCurrent: number | null;
  avgPositionDynamics: number | null;
  ordersCurrent: number | null;
  ordersDynamics: number | null;
  openCardCurrent: number | null;
  openCardDynamics: number | null;
  addToCartCurrent: number | null;
  addToCartDynamics: number | null;
  openToCartCurrent: number | null;
  openToCartDynamics: number | null;
  syncedAt: string | null;
};

export async function fetchRawJamRows(opts?: {
  nmId?: number;
  dateFrom?: string;
  dateTo?: string;
  /**
   * Maximum rows to return.  When omitted and nmId is provided the backend
   * returns ALL rows for that product with no cap.  When omitted and nmId is
   * absent the backend defaults to 2000 (safety cap for the global view).
   */
  limit?: number;
  /** AbortSignal to cancel the in-flight request when a newer one starts. */
  signal?: AbortSignal;
}): Promise<RawJamRow[]> {
  const params = new URLSearchParams();
  if (opts?.nmId != null) params.set("nmId", String(opts.nmId));
  if (opts?.dateFrom) params.set("dateFrom", opts.dateFrom);
  if (opts?.dateTo) params.set("dateTo", opts.dateTo);
  // Only forward the limit when the caller explicitly set it.
  // With nmId present we intentionally omit it so the backend returns all rows.
  if (opts?.limit != null && opts.nmId == null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const response = await apiClient.get<unknown>(
    `/wb-clusters/raw/jam-rows${qs ? `?${qs}` : ""}`,
    {
      signal: opts?.signal,
      // JAM rows can be large — override the global 10 s timeout.
      timeout: 60_000,
    },
  );
  if (!Array.isArray(response.data)) throw new Error("Invalid raw JAM rows response.");
  return response.data as RawJamRow[];
}

export type RawCampaignRow = {
  advertId: number;
  campaignType: number | null;
  campaignStatus: number | null;
  paymentType: string | null;
  bidType: string | null;
  currency: string | null;
  name: string | null;
  changeTime: string | null;
  createdAtWb: string | null;
  startedAtWb: string | null;
  updatedAtWb: string | null;
  syncedAt: string | null;
};

export async function fetchRawCampaigns(limit?: number): Promise<RawCampaignRow[]> {
  const qs = limit != null ? `?limit=${limit}` : "";
  const response = await apiClient.get<unknown>(`/wb-clusters/raw/campaigns${qs}`);
  if (!Array.isArray(response.data)) throw new Error("Invalid raw campaigns response.");
  return response.data as RawCampaignRow[];
}

export type RawCampaignProductRow = {
  advertId: number;
  nmId: number;
  campaignName: string | null;
  campaignType: number | null;
  campaignStatus: number | null;
  subjectId: number | null;
  subjectName: string | null;
  searchBid: number | null;
  minSearchBid: number | null;
  syncedAt: string | null;
};

export async function fetchRawCampaignProducts(opts?: {
  nmId?: number;
  limit?: number;
}): Promise<RawCampaignProductRow[]> {
  const params = new URLSearchParams();
  if (opts?.nmId != null) params.set("nmId", String(opts.nmId));
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const response = await apiClient.get<unknown>(`/wb-clusters/raw/campaign-products${qs ? `?${qs}` : ""}`);
  if (!Array.isArray(response.data)) throw new Error("Invalid raw campaign products response.");
  return response.data as RawCampaignProductRow[];
}

export type RawSyncRunRow = {
  id: string;
  trigger: string | null;
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  campaignsSeen: number | null;
  campaignsSynced: number | null;
  productsSeen: number | null;
  clustersUpserted: number | null;
  statsRowsUpserted: number | null;
  warningCount: number | null;
  hasPartialFailure: boolean | null;
  errorMessage: string | null;
  createdAt: string | null;
};

export async function fetchRawSyncRuns(limit?: number): Promise<RawSyncRunRow[]> {
  const qs = limit != null ? `?limit=${limit}` : "";
  const response = await apiClient.get<unknown>(`/wb-clusters/raw/sync-runs${qs}`);
  if (!Array.isArray(response.data)) throw new Error("Invalid raw sync runs response.");
  return response.data as RawSyncRunRow[];
}

export type RawClusterStatRow = {
  clusterKey: string;
  advertId: number;
  nmId: number;
  clusterName: string | null;
  sourceKind: string | null;
  isActive: boolean | null;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  addToCart: number | null;
  ctr: number | null;
  avgPosition: number | null;
  cpc: number | null;
  cpm: number | null;
  spend: number | null;
  currency: string | null;
  syncedAt: string | null;
};

export async function fetchRawClusterStats(opts?: {
  nmId?: number;
  limit?: number;
}): Promise<RawClusterStatRow[]> {
  const params = new URLSearchParams();
  if (opts?.nmId != null) params.set("nmId", String(opts.nmId));
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const response = await apiClient.get<unknown>(`/wb-clusters/raw/cluster-stats${qs ? `?${qs}` : ""}`);
  if (!Array.isArray(response.data)) throw new Error("Invalid raw cluster stats response.");
  return response.data as RawClusterStatRow[];
}

export type RawDailyStatRow = {
  dailyStatKey: string;
  advertId: number;
  nmId: number;
  statDate: string;
  clusterName: string | null;
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
  syncedAt: string | null;
};

export async function fetchRawDailyStats(opts?: {
  nmId?: number;
  limit?: number;
}): Promise<RawDailyStatRow[]> {
  const params = new URLSearchParams();
  if (opts?.nmId != null) params.set("nmId", String(opts.nmId));
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const response = await apiClient.get<unknown>(`/wb-clusters/raw/daily-stats${qs ? `?${qs}` : ""}`);
  if (!Array.isArray(response.data)) throw new Error("Invalid raw daily stats response.");
  return response.data as RawDailyStatRow[];
}

export type RawMinusPhraseRow = {
  advertId: number;
  nmId: number;
  phrase: string;
  normalizedPhrase: string;
  syncedAt: string | null;
};

export async function fetchRawMinusPhrases(opts?: {
  nmId?: number;
  limit?: number;
}): Promise<RawMinusPhraseRow[]> {
  const params = new URLSearchParams();
  if (opts?.nmId != null) params.set("nmId", String(opts.nmId));
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const response = await apiClient.get<unknown>(`/wb-clusters/raw/minus-phrases${qs ? `?${qs}` : ""}`);
  if (!Array.isArray(response.data)) throw new Error("Invalid raw minus phrases response.");
  return response.data as RawMinusPhraseRow[];
}

export type RawQueryFrequencyRow = {
  normalizedQueryText: string;
  queryText: string;
  monthlyFrequency: number | null;
  reportType: string | null;
  reportStartDate: string | null;
  reportEndDate: string | null;
  syncedAt: string | null;
};

export async function fetchRawQueryFrequencies(limit?: number): Promise<RawQueryFrequencyRow[]> {
  const qs = limit != null ? `?limit=${limit}` : "";
  const response = await apiClient.get<unknown>(`/wb-clusters/raw/query-frequencies${qs}`);
  if (!Array.isArray(response.data)) throw new Error("Invalid raw query frequencies response.");
  return response.data as RawQueryFrequencyRow[];
}

export async function fetchProductSearchTextsRange(input: {
  nmId: number;
  startDate: string;
  endDate: string;
}) {
  const response = await apiClient.post<unknown>("/wb-sync/product-search-texts/range", input, {
    timeout: Math.max(advertisingApiTimeoutMs, 120_000),
  });
  if (!isProductSearchTextsRangeResponse(response.data)) {
    throw new Error("Invalid product search texts range response.");
  }

  return response.data;
}
