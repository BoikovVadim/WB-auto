import type {
  SyncEntity,
  SyncStatus,
  SyncStepCode,
  TokenSource,
} from "./syncClientTypes";

export const validEntities = ["search_queries", "product_search_texts"] as const;
export const validStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "retry_scheduled",
] as const;
export const validStepCodes = [
  "token_check",
  "raw_fetch",
  "normalize_records",
  "prepare_processing",
] as const;
export const validTokenSources = ["runtime", "env", "missing"] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isIsoDateString(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

export function isNullableIsoDateString(value: unknown): value is string | null {
  return value === null || isIsoDateString(value);
}

export function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

export function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

export function isNullableDateOnlyString(value: unknown) {
  return value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function isSupportedMethod(value: unknown): value is "GET" | "POST" {
  return value === "GET" || value === "POST";
}

export function isSyncEntity(value: unknown): value is SyncEntity {
  return validEntities.includes(value as SyncEntity);
}

export function isSyncStatus(value: unknown): value is SyncStatus {
  return validStatuses.includes(value as SyncStatus);
}

export function isSyncStepCode(value: unknown): value is SyncStepCode {
  return validStepCodes.includes(value as SyncStepCode);
}

export function isTokenSource(value: unknown): value is TokenSource {
  return validTokenSources.includes(value as TokenSource);
}
