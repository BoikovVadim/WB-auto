import { apiClient, buildWbClustersWriteHeaders } from "./syncClientHttp";

export type AutomationMode = "off" | "preview" | "live";
export type ClusterAutomationState =
  | "active"
  | "excluded_high"
  | "dropped"
  | "manual_protected"
  | "protected"
  | "blacklisted";

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

// --- Настройка фильтров (защищённые кластеры) ---

export type ClusterFilterRow = {
  normalizedClusterName: string;
  clusterName: string;
  lastCpo: number | null;
  state: ClusterAutomationState | null;
  /** Белый список — нельзя выключать. */
  isProtected: boolean;
  /** Чёрный список — нельзя включать (приоритет над белым). */
  isBlacklisted: boolean;
};

export type ClusterFilterItem = { normalizedClusterName: string; clusterName: string };
export type ClusterFilterConfig = { clusters: ClusterFilterRow[] };

const EMPTY_CONFIG: ClusterFilterConfig = { clusters: [] };

export async function fetchClusterFilterConfig(
  nmId: number,
  advertId: number,
): Promise<ClusterFilterConfig> {
  const response = await apiClient.get<ClusterFilterConfig>(
    `/wb-clusters/products/${nmId}/campaigns/${advertId}/automation/config`,
  );
  return response.data ?? EMPTY_CONFIG;
}

export async function setClusterFilters(
  nmId: number,
  advertId: number,
  input: { protected: ClusterFilterItem[]; blacklisted: ClusterFilterItem[] },
): Promise<ClusterFilterConfig> {
  const response = await apiClient.put<ClusterFilterConfig>(
    `/wb-clusters/products/${nmId}/campaigns/${advertId}/automation/config`,
    input,
    { headers: buildWbClustersWriteHeaders() },
  );
  return response.data ?? EMPTY_CONFIG;
}
