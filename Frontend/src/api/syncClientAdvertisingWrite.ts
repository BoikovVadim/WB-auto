import {
  assertProductAdvertisingClusterActionResponse,
  assertProductAdvertisingClusterBidUpdateResponse,
  assertProductAdvertisingMaterializeStartResponse,
  assertProductAdvertisingRefreshStartResponse,
  assertProductAdvertisingSyncStartResponse,
} from "./syncClientValidators";
import {
  advertisingApiTimeoutMs,
  apiClient,
  buildWbClustersWriteHeaders,
} from "./syncClientHttp";

export async function materializeProductAdvertisingSheets(input: {
  nmIds: number[];
  reason?: string;
  exportRequestId?: string;
  startDate?: string;
  endDate?: string;
  priority?: "visible" | "candidate" | "background";
}) {
  const response = await apiClient.post<unknown>("/wb-clusters/products/materialize", input, {
    timeout: Math.max(advertisingApiTimeoutMs, 120_000),
    headers: buildWbClustersWriteHeaders(),
  });
  assertProductAdvertisingMaterializeStartResponse(response.data);
  return response.data;
}

export async function refreshProductAdvertisingSheet(nmId: number) {
  const response = await apiClient.post<unknown>(
    `/wb-clusters/products/${nmId}/refresh`,
    undefined,
    {
      timeout: advertisingApiTimeoutMs,
      headers: buildWbClustersWriteHeaders(),
    },
  );
  assertProductAdvertisingRefreshStartResponse(response.data);
  return response.data;
}

export async function applyProductAdvertisingClusterAction(
  nmId: number,
  advertId: number,
  action: "include" | "exclude",
  clusterNames: string[],
) {
  const response = await apiClient.post<unknown>(
    `/wb-clusters/products/${nmId}/campaigns/${advertId}/clusters/action`,
    { action, clusterNames },
    {
      timeout: advertisingApiTimeoutMs,
      headers: buildWbClustersWriteHeaders(),
    },
  );
  assertProductAdvertisingClusterActionResponse(response.data);
  return response.data;
}

export async function applyProductAdvertisingClusterBid(
  nmId: number,
  advertId: number,
  clusterName: string,
  bid: number,
) {
  const response = await apiClient.post<unknown>(
    `/wb-clusters/products/${nmId}/campaigns/${advertId}/clusters/bids`,
    {
      bids: [{ clusterName, bid }],
    },
    {
      timeout: advertisingApiTimeoutMs,
      headers: buildWbClustersWriteHeaders(),
    },
  );
  assertProductAdvertisingClusterBidUpdateResponse(response.data);
  return response.data;
}

export async function runProductAdvertisingSync(mode: "full" | "inventory" = "full") {
  const response = await apiClient.post<unknown>(
    "/wb-clusters/sync",
    {
      trigger: "manual",
      mode,
    },
    {
      timeout: advertisingApiTimeoutMs,
      headers: buildWbClustersWriteHeaders(),
    },
  );
  assertProductAdvertisingSyncStartResponse(response.data);
  return response.data;
}
