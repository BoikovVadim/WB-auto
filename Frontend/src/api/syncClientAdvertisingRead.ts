import type { ProductAdvertisingSheetRequestInput } from "./productAdvertisingSheetIdentity";
import { cacheProductAdvertisingSheet } from "./productSnapshotCache";
import {
  assertProductAdvertisingRefreshStatusResponse,
  assertProductSnapshotReadinessResponse,
  assertProductAdvertisingSheetBundleResponse,
  assertProductAdvertisingSheetResponse,
  assertProductClusterLookupResponse,
} from "./syncClientValidators";
import {
  advertisingApiTimeoutMs,
  apiClient,
  buildWbClustersWriteHeaders,
  productAdvertisingSheetRequestInFlight,
} from "./syncClientHttp";

// Workspace/cluster-table фетчеры вынесены по объёму; реэкспорт сохраняет единый путь импорта.
export * from "./syncClientAdvertisingReadWorkspace";

export async function lookupProductClusters(nmId: number, queries: string[]) {
  const response = await apiClient.post<unknown>(`/wb-clusters/products/${nmId}/lookup`, {
    queries,
  });
  assertProductClusterLookupResponse(response.data);
  return response.data;
}

export async function fetchProductAdvertisingSheet(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput,
) {
  const requestKey = [
    nmId,
    input?.startDate ?? "none",
    input?.endDate ?? "none",
  ].join(":");
  const inFlightRequest = productAdvertisingSheetRequestInFlight.get(requestKey);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const requestPromise = apiClient
    .get<unknown>(`/wb-clusters/products/${nmId}/advertising-sheet`, {
      timeout: advertisingApiTimeoutMs,
      params: input
        ? {
            startDate: input.startDate,
            endDate: input.endDate,
          }
        : undefined,
    })
    .then((response) => {
      assertProductAdvertisingSheetResponse(response.data);
      cacheProductAdvertisingSheet(nmId, input, response.data);
      return response.data;
    })
    .finally(() => {
      productAdvertisingSheetRequestInFlight.delete(requestKey);
    });

  productAdvertisingSheetRequestInFlight.set(requestKey, requestPromise);
  return requestPromise;
}

export async function fetchProductAdvertisingSheetBundle(input: {
  nmIds: number[];
  startDate: string;
  endDate: string;
}) {
  const response = await apiClient.post<unknown>(
    "/wb-clusters/products/advertising-sheet-bundle",
    input,
    {
      timeout: Math.max(advertisingApiTimeoutMs, 120_000),
    },
  );
  assertProductAdvertisingSheetBundleResponse(response.data);
  for (const sheet of response.data.sheets) {
    cacheProductAdvertisingSheet(
      sheet.nmId,
      {
        startDate: response.data.range.startDate,
        endDate: response.data.range.endDate,
      },
      sheet,
    );
  }
  return response.data;
}

export async function fetchProductSnapshotReadiness(input: {
  nmIds: number[];
  startDate: string;
  endDate: string;
  exportRequestId?: string;
}) {
  const response = await apiClient.post<unknown>(
    "/wb-clusters/products/advertising-sheet-readiness",
    input,
    {
      timeout: Math.max(advertisingApiTimeoutMs, 60_000),
    },
  );
  assertProductSnapshotReadinessResponse(response.data);
  return response.data;
}

export async function fetchProductAdvertisingRefreshStatus(
  nmId: number,
  syncRunId: string,
) {
  const response = await apiClient.get<unknown>(
    `/wb-clusters/products/${nmId}/refresh/${syncRunId}`,
    {
      timeout: advertisingApiTimeoutMs,
      headers: buildWbClustersWriteHeaders(),
    },
  );
  assertProductAdvertisingRefreshStatusResponse(response.data);
  return response.data;
}

export type ClusterChangeLogEntry = {
  id: string;
  nmId: number;
  advertId: number;
  clusterName: string;
  changeType: "status_change" | "bid_change" | "automation_mode";
  oldValue: string | null;
  newValue: string;
  jobId: string | null;
  /** Кто инициировал смену: 'user' (вручную) / 'automation' (движок) / null (старые записи). */
  initiatedBy: "user" | "automation" | null;
  /** Причина авто-смены ставки (up/down/at_cap/...); null у ручных/статусных. */
  reason: string | null;
  /** Замеренная позиция в выдаче на момент авто-смены ставки; null у ручных/статусных. */
  position: number | null;
  appliedAt: string;
};

export async function fetchClusterChangeLog(
  nmId: number,
  advertId: number,
): Promise<ClusterChangeLogEntry[]> {
  const response = await apiClient.get<{ entries: ClusterChangeLogEntry[] }>(
    `/wb-clusters/products/${String(nmId)}/campaigns/${String(advertId)}/clusters/change-log`,
    { timeout: advertisingApiTimeoutMs },
  );
  const data = response.data;
  if (
    !data ||
    typeof data !== "object" ||
    !("entries" in data) ||
    !Array.isArray((data as { entries: unknown }).entries)
  ) {
    return [];
  }
  return (data as { entries: ClusterChangeLogEntry[] }).entries;
}
