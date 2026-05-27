import { apiClient, buildWbClustersWriteHeaders } from "./syncClientHttp";

export type CostPriceCurrent = {
  nmId: number;
  costValue: number;
  effectiveDate: string;
  updatedAt: string;
};

export type CostPriceHistoryEntry = {
  nmId: number;
  costValue: number;
  effectiveDate: string;
  updatedAt: string;
};

export async function fetchAllCostPrices(): Promise<CostPriceCurrent[]> {
  const response = await apiClient.get<{ items: CostPriceCurrent[] }>(
    "/wb-clusters/products/cost-prices",
  );
  return response.data?.items ?? [];
}

export async function fetchCostPriceHistory(nmId: number): Promise<CostPriceHistoryEntry[]> {
  const response = await apiClient.get<{ nmId: number; history: CostPriceHistoryEntry[] }>(
    `/wb-clusters/products/${String(nmId)}/cost-price-history`,
  );
  return response.data?.history ?? [];
}

export async function saveCostPrice(nmId: number, costValue: number): Promise<CostPriceCurrent> {
  const response = await apiClient.put<CostPriceCurrent>(
    `/wb-clusters/products/${String(nmId)}/cost-price`,
    { costValue },
    { headers: buildWbClustersWriteHeaders() },
  );
  return response.data;
}

export async function clearCostPrice(nmId: number): Promise<void> {
  await apiClient.delete(`/wb-clusters/products/${String(nmId)}/cost-price`, {
    headers: buildWbClustersWriteHeaders(),
  });
}

export type CostPriceMatrix = {
  dates: string[];
  products: { nmId: number; values: (number | null)[] }[];
};

export async function fetchCostPriceMatrix(): Promise<CostPriceMatrix> {
  const response = await apiClient.get<CostPriceMatrix>(
    "/wb-clusters/products/cost-price-matrix",
  );
  return response.data ?? { dates: [], products: [] };
}
