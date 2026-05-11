export const syncEntities = ["search_queries", "product_search_texts"] as const;

export type SyncEntity = (typeof syncEntities)[number];

export const syncStepCodes = [
  "token_check",
  "raw_fetch",
  "normalize_records",
  "prepare_processing",
] as const;

export type SyncStepCode = (typeof syncStepCodes)[number];

export const syncJobStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "retry_scheduled",
] as const;

export type SyncJobStatus = (typeof syncJobStatuses)[number];

export interface SyncEntityDescriptor {
  code: SyncEntity;
  method: "GET" | "POST";
  path: string;
  documentationUrl: string;
  tokenCategory: string;
}

export interface ExportMethodCooldown {
  cooldownSeconds: number;
  startedAt: string | null;
  nextAvailableAt: string | null;
  waitSeconds: number;
  isActive: boolean;
}

export interface ExportMethodStatus {
  entityType: SyncEntity;
  title: string;
  description: string;
  documentationUrl: string;
  tokenCategory: string;
  apiPath: string;
  cooldown: ExportMethodCooldown;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastRequestId: string | null;
  lastErrorMessage: string | null;
  latestExportId: string | null;
}

export interface SearchQueriesPeriod {
  currentStart: string;
  currentEnd: string;
  pastStart: string;
  pastEnd: string;
}

export interface SearchQueryMetricValue {
  current: number | null;
  dynamics: number | null;
}

export interface SearchQueryTextView {
  text: string;
  frequency: number | null;
  weekFrequency: number | null;
  wbCluster: string | null;
  avgPosition: SearchQueryMetricValue;
  orders: SearchQueryMetricValue;
  openCard: SearchQueryMetricValue;
  addToCart: SearchQueryMetricValue;
  openToCart: SearchQueryMetricValue;
}

export interface ProductSearchTextsRangeResponse {
  nmId: number;
  checkedAt: string;
  period: {
    start: string;
    end: string;
  };
  searchTexts: SearchQueryTextView[];
}

export interface SearchQueryProductView {
  nmId: number;
  name: string;
  vendorCode: string;
  brandName: string;
  subjectName: string;
  avgPosition: SearchQueryMetricValue;
  openCard: SearchQueryMetricValue;
  addToCart: SearchQueryMetricValue;
  openToCart: SearchQueryMetricValue;
  orders: SearchQueryMetricValue;
  cartToOrder: SearchQueryMetricValue;
  visibility: SearchQueryMetricValue;
  searchTexts: SearchQueryTextView[];
}

export interface WbRawTableView {
  id: string;
  title: string;
  rows: Record<string, unknown>[];
  flattenedRows?: Record<string, unknown>[];
  columns?: string[];
}

export interface ExportProductIndexItem {
  vendorCode: string;
  nmId: number;
}

export interface SearchQueriesExportPayload {
  period: SearchQueriesPeriod;
  summary: {
    productsCount: number;
    searchTextsCount: number;
    sourcePagesFetched: number;
    productBatchesFetched: number;
  };
  products: SearchQueryProductView[];
  productIndex?: ExportProductIndexItem[];
  wbTables?: WbRawTableView[];
}

export interface SyncPreviewResponse {
  jobId: string;
  direction: "inbound";
  entityType: SyncEntity;
  status: SyncJobStatus;
  source: "wb-api";
  target: "raw-layer";
  wbApiBaseUrl: string;
  dataIntegrity: "valid";
  endpoint: {
    method: "GET" | "POST";
    path: string;
    documentationUrl: string;
  };
  audit: {
    requestedAt: string;
    requestedBy: string;
  };
  nextStepCodes: SyncStepCode[];
}

export interface IntegrationStatusResponse {
  service: "wb-api";
  connectionStatus: "ready" | "missing_token";
  apiBaseUrl: string;
  tokenConfigured: boolean;
  tokenSource: "runtime" | "env" | "missing";
  authScheme: "Authorization HeaderApiKey";
  locale: string;
  dataIntegrity: "valid";
  supportedEntities: SyncEntityDescriptor[];
  checkedAt: string;
}

export interface TokenSessionResponse {
  tokenConfigured: boolean;
  tokenSource: "runtime" | "env" | "missing";
  updatedAt: string;
}

export interface WbExportResponse {
  requestId: string;
  exportStatus: "succeeded";
  entityType: SyncEntity;
  exportedAt: string;
  dataIntegrity: "valid";
  endpoint: {
    method: "GET" | "POST";
    path: string;
    documentationUrl: string;
  };
  recordsCount: number | null;
  requestMeta: {
    locale: string;
    customPayloadApplied: boolean;
    period?: SearchQueriesPeriod;
    rawArchivePath?: string;
  };
  payload: SearchQueriesExportPayload;
}

export interface WbExportJobRequestMeta {
  locale: string;
  customPayloadApplied: boolean;
  period?: SearchQueriesPeriod;
}

export interface WbExportJobResponse {
  requestId: string;
  entityType: SyncEntity;
  status: Exclude<SyncJobStatus, "retry_scheduled">;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  dataIntegrity: "valid";
  endpoint: {
    method: "GET" | "POST";
    path: string;
    documentationUrl: string;
  };
  requestMeta: WbExportJobRequestMeta;
  recordsCount: number | null;
  resultAvailable: boolean;
  errorMessage: string | null;
}

export interface WbExportListItem {
  requestId: string;
  entityType: SyncEntity;
  exportedAt: string;
  recordsCount: number | null;
  productsCount: number;
  searchTextsCount: number;
  period: SearchQueriesPeriod;
  rawArchivePath: string | null;
}
