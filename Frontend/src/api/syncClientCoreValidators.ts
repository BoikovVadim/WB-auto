import type {
  ExportMethodStatus,
  HealthResponse,
  IntegrationStatusResponse,
  SupportedEntityDescriptor,
  SyncPreviewResponse,
  TokenSessionResponse,
} from "./syncClientTypes";
import {
  isIsoDateString,
  isNonEmptyString,
  isRecord,
  isSupportedMethod,
  isSyncEntity,
  isSyncStatus,
  isSyncStepCode,
  isTokenSource,
} from "./syncClientValidatorUtils";

function isSupportedEntityDescriptor(
  value: unknown,
): value is SupportedEntityDescriptor {
  return (
    isRecord(value) &&
    isSyncEntity(value.code) &&
    isSupportedMethod(value.method) &&
    isNonEmptyString(value.path) &&
    isNonEmptyString(value.documentationUrl) &&
    isNonEmptyString(value.tokenCategory)
  );
}

export function assertHealthResponse(
  value: unknown,
): asserts value is HealthResponse {
  if (
    !isRecord(value) ||
    value.status !== "ok" ||
    value.service !== "wb-automation-backend" ||
    !isNonEmptyString(value.environment) ||
    !isRecord(value.checks) ||
    typeof value.checks.wbApiConfigured !== "boolean" ||
    !isIsoDateString(value.timestamp)
  ) {
    throw new Error("Invalid health response.");
  }
}

export function assertIntegrationStatusResponse(
  value: unknown,
): asserts value is IntegrationStatusResponse {
  if (!isRecord(value)) {
    throw new Error("Invalid integration status response.");
  }

  if (
    value.service !== "wb-api" ||
    (value.connectionStatus !== "ready" &&
      value.connectionStatus !== "missing_token") ||
    !isNonEmptyString(value.apiBaseUrl) ||
    typeof value.tokenConfigured !== "boolean" ||
    !isTokenSource(value.tokenSource) ||
    value.authScheme !== "Authorization HeaderApiKey" ||
    !isNonEmptyString(value.locale) ||
    value.dataIntegrity !== "valid" ||
    !Array.isArray(value.supportedEntities) ||
    value.supportedEntities.some((entity) => !isSupportedEntityDescriptor(entity)) ||
    !isIsoDateString(value.checkedAt)
  ) {
    throw new Error("Invalid integration status response.");
  }
}

export function assertTokenSessionResponse(
  value: unknown,
): asserts value is TokenSessionResponse {
  if (
    !isRecord(value) ||
    typeof value.tokenConfigured !== "boolean" ||
    !isTokenSource(value.tokenSource) ||
    !isIsoDateString(value.updatedAt)
  ) {
    throw new Error("Invalid token session response.");
  }
}

export function assertExportMethodsResponse(
  value: unknown,
): asserts value is ExportMethodStatus[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid export methods response.");
  }

  for (const item of value) {
    if (
      !isRecord(item) ||
      !isSyncEntity(item.entityType) ||
      !isNonEmptyString(item.title) ||
      !isNonEmptyString(item.description) ||
      !isNonEmptyString(item.documentationUrl) ||
      !isNonEmptyString(item.tokenCategory) ||
      !isNonEmptyString(item.apiPath) ||
      !isRecord(item.cooldown) ||
      typeof item.cooldown.cooldownSeconds !== "number" ||
      (item.cooldown.startedAt !== null &&
        item.cooldown.startedAt !== undefined &&
        !isIsoDateString(item.cooldown.startedAt)) ||
      (item.cooldown.nextAvailableAt !== null &&
        item.cooldown.nextAvailableAt !== undefined &&
        !isIsoDateString(item.cooldown.nextAvailableAt)) ||
      typeof item.cooldown.waitSeconds !== "number" ||
      typeof item.cooldown.isActive !== "boolean" ||
      (item.lastAttemptAt !== null &&
        item.lastAttemptAt !== undefined &&
        !isIsoDateString(item.lastAttemptAt)) ||
      (item.lastSuccessAt !== null &&
        item.lastSuccessAt !== undefined &&
        !isIsoDateString(item.lastSuccessAt)) ||
      (item.lastRequestId !== null &&
        item.lastRequestId !== undefined &&
        !isNonEmptyString(item.lastRequestId)) ||
      (item.lastErrorMessage !== null &&
        item.lastErrorMessage !== undefined &&
        !isNonEmptyString(item.lastErrorMessage)) ||
      (item.latestExportId !== null &&
        item.latestExportId !== undefined &&
        !isNonEmptyString(item.latestExportId))
    ) {
      throw new Error("Invalid export methods response.");
    }
  }
}

export function assertSyncPreviewResponse(
  value: unknown,
): asserts value is SyncPreviewResponse {
  if (!isRecord(value)) {
    throw new Error("Invalid preview response.");
  }

  if (
    !isNonEmptyString(value.jobId) ||
    value.direction !== "inbound" ||
    !isSyncEntity(value.entityType) ||
    !isSyncStatus(value.status) ||
    value.source !== "wb-api" ||
    value.target !== "raw-layer" ||
    !isNonEmptyString(value.wbApiBaseUrl) ||
    value.dataIntegrity !== "valid" ||
    !isRecord(value.endpoint) ||
    !isSupportedMethod(value.endpoint.method) ||
    !isNonEmptyString(value.endpoint.path) ||
    !isNonEmptyString(value.endpoint.documentationUrl) ||
    !isRecord(value.audit) ||
    !isIsoDateString(value.audit.requestedAt) ||
    !isNonEmptyString(value.audit.requestedBy) ||
    !Array.isArray(value.nextStepCodes) ||
    value.nextStepCodes.some((step) => !isSyncStepCode(step))
  ) {
    throw new Error("Invalid preview response.");
  }
}
