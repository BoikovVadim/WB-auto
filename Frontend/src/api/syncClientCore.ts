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
