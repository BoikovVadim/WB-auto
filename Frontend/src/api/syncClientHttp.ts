import axios from "axios";

import { buildApiPath } from "../runtimePaths";
import type { ProductAdvertisingSheetResponse } from "./syncClientTypes";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? buildApiPath("");
const wbClustersWriteApiKey = (import.meta.env.VITE_WB_CLUSTERS_WRITE_API_KEY ?? "").trim();

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 10000,
});

export const advertisingApiTimeoutMs = 45_000;

export const productAdvertisingSheetRequestInFlight = new Map<
  string,
  Promise<ProductAdvertisingSheetResponse>
>();

export function buildWbClustersWriteHeaders() {
  return {
    "X-WB-Write-Intent": "dashboard",
    ...(wbClustersWriteApiKey ? { "X-WB-Write-Key": wbClustersWriteApiKey } : {}),
  };
}
