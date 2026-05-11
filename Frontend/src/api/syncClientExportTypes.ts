import type { SyncEntity } from "./syncClientBaseTypes";

export interface SearchQueriesPeriod {
  currentStart: string;
  currentEnd: string;
  pastStart: string;
  pastEnd: string;
}

export interface MetricValue {
  current: number | null;
  dynamics: number | null;
}

export interface SearchQueryText {
  text: string;
  frequency: number | null;
  weekFrequency: number | null;
  wbCluster: string | null;
  avgPosition: MetricValue;
  orders: MetricValue;
  openCard: MetricValue;
  addToCart: MetricValue;
  openToCart: MetricValue;
}

export interface ProductSearchTextsRangeResponse {
  nmId: number;
  checkedAt: string;
  period: {
    start: string;
    end: string;
  };
  searchTexts: SearchQueryText[];
}

export interface SearchQueryProduct {
  nmId: number;
  name: string;
  vendorCode: string;
  brandName: string;
  subjectName: string;
  avgPosition: MetricValue;
  openCard: MetricValue;
  addToCart: MetricValue;
  openToCart: MetricValue;
  orders: MetricValue;
  cartToOrder: MetricValue;
  visibility: MetricValue;
  searchTexts: SearchQueryText[];
}

export interface WbRawTable {
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
  products: SearchQueryProduct[];
  productIndex?: ExportProductIndexItem[];
  wbTables?: WbRawTable[];
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

export interface WbExportJobResponse {
  requestId: string;
  entityType: SyncEntity;
  status: "queued" | "running" | "succeeded" | "failed";
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  dataIntegrity: "valid";
  endpoint: {
    method: "GET" | "POST";
    path: string;
    documentationUrl: string;
  };
  requestMeta: {
    locale: string;
    customPayloadApplied: boolean;
    period?: SearchQueriesPeriod;
  };
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
