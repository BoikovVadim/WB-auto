export interface HealthResponse {
  status: "ok";
  service: "wb-automation-backend";
  environment: string;
  uptimeSeconds: number;
  checks: {
    wbApiConfigured: boolean;
    wbPromotionApiConfigured: boolean;
    postgresConfigured: boolean;
    writeGuardConfigured: boolean;
  };
  timestamp: string;
}

export type SyncEntity = "search_queries" | "product_search_texts";
export type SyncStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "retry_scheduled";
export type SyncStepCode =
  | "token_check"
  | "raw_fetch"
  | "normalize_records"
  | "prepare_processing";
export type TokenSource = "runtime" | "env" | "missing";

export interface SupportedEntityDescriptor {
  code: SyncEntity;
  method: "GET" | "POST";
  path: string;
  documentationUrl: string;
  tokenCategory: string;
}

export interface IntegrationStatusResponse {
  service: "wb-api";
  connectionStatus: "ready" | "missing_token";
  apiBaseUrl: string;
  tokenConfigured: boolean;
  tokenSource: TokenSource;
  authScheme: "Authorization HeaderApiKey";
  locale: string;
  dataIntegrity: "valid";
  supportedEntities: SupportedEntityDescriptor[];
  checkedAt: string;
}

export interface TokenSessionResponse {
  tokenConfigured: boolean;
  tokenSource: TokenSource;
  updatedAt: string;
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

export interface SyncPreviewResponse {
  jobId: string;
  direction: "inbound";
  entityType: SyncEntity;
  status: SyncStatus;
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
