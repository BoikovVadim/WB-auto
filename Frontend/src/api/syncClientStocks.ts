import { apiClient } from "./syncClientHttp";

export type StocksMatrixRow = {
  nmId: number;
  stockDate: string;
  quantity: number;
};

export type LatestStockRow = {
  nmId: number;
  quantity: number;
};

export async function fetchLatestStocks(): Promise<LatestStockRow[]> {
  const response = await apiClient.get<LatestStockRow[]>(
    "/wb-clusters/products/latest-stocks",
  );
  return Array.isArray(response.data) ? response.data : [];
}

export async function fetchStocksMatrix(): Promise<StocksMatrixRow[]> {
  const response = await apiClient.get<StocksMatrixRow[]>(
    "/wb-clusters/products/stocks-matrix",
  );
  return Array.isArray(response.data) ? response.data : [];
}
