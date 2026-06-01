import { apiClient, buildWbClustersWriteHeaders } from "./syncClientHttp";

export type AutomationMode = "off" | "preview" | "live";
export type ClusterAutomationState =
  | "active"
  | "excluded_high"
  | "dropped"
  | "manual_protected";

export type ClusterAutomationStatus = {
  mode: AutomationMode;
  /** Макс. CPO товара (порог) — ₽. */
  maxCpo: number | null;
  clusters: {
    normalizedClusterName: string;
    state: ClusterAutomationState;
    manualProtected: boolean;
    lastCpo: number | null;
    lastDecision: string | null;
  }[];
};

const EMPTY: ClusterAutomationStatus = { mode: "off", maxCpo: null, clusters: [] };

export async function fetchClusterAutomationStatus(
  nmId: number,
  advertId: number,
): Promise<ClusterAutomationStatus> {
  const response = await apiClient.get<ClusterAutomationStatus>(
    `/wb-clusters/products/${nmId}/campaigns/${advertId}/automation`,
  );
  return response.data ?? EMPTY;
}

export async function setClusterAutomationMode(
  nmId: number,
  advertId: number,
  mode: AutomationMode,
): Promise<ClusterAutomationStatus> {
  const response = await apiClient.put<ClusterAutomationStatus>(
    `/wb-clusters/products/${nmId}/campaigns/${advertId}/automation`,
    { mode },
    { headers: buildWbClustersWriteHeaders() },
  );
  return response.data ?? { ...EMPTY, mode };
}
