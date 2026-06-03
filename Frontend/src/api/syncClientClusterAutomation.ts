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

export type ProductAutomationStatusEntry = {
  mode: AutomationMode;
  campaignsWithAutomation: number;
};

export type ProductAutomationStatusesResponse = {
  byNmId: Record<number, ProductAutomationStatusEntry>;
};

/** Сводный статус автоматизации по всем товарам — для колонки в таблице товаров. */
export async function fetchProductAutomationStatuses(): Promise<ProductAutomationStatusesResponse> {
  const response = await apiClient.get<ProductAutomationStatusesResponse>(
    "/wb-clusters/products/automation-status",
  );
  return response.data ?? { byNmId: {} };
}

// --- Автоматизация по ТОВАРУ (модалка из колонки «Авто») ---

export type ProductAutomationDetail = {
  nmId: number;
  /** Режим товара: live > preview > off. */
  mode: AutomationMode;
  campaigns: { advertId: number; name: string | null; mode: AutomationMode }[];
  /** Агрегированные счётчики кластеров по всем кампаниям товара. */
  counts: { active: number; blacklisted: number; high: number };
};

const EMPTY_PRODUCT_DETAIL: ProductAutomationDetail = {
  nmId: 0,
  mode: "off",
  campaigns: [],
  counts: { active: 0, blacklisted: 0, high: 0 },
};

/** Детализация автоматизации по одному товару (режим + кампании + счётчики). */
export async function fetchProductAutomationDetail(nmId: number): Promise<ProductAutomationDetail> {
  const response = await apiClient.get<ProductAutomationDetail>(
    `/wb-clusters/products/${nmId}/automation`,
  );
  return response.data ?? { ...EMPTY_PRODUCT_DETAIL, nmId };
}

/** Сменить режим автоматизации сразу для всех кампаний товара. */
export async function setProductAutomationMode(
  nmId: number,
  mode: AutomationMode,
): Promise<ProductAutomationDetail> {
  const response = await apiClient.put<ProductAutomationDetail>(
    `/wb-clusters/products/${nmId}/automation`,
    { mode },
    { headers: buildWbClustersWriteHeaders() },
  );
  return response.data ?? { ...EMPTY_PRODUCT_DETAIL, nmId, mode };
}

// --- Настройка фильтров (защищённые кластеры) ---

export type ClusterFilterRow = {
  normalizedClusterName: string;
  clusterName: string;
  lastCpo: number | null;
  /** Расход кластера за окно — «стоимость» там, где заказов нет и CPO неопределён. */
  lastSpend: number | null;
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
