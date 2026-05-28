import { apiClient } from "./syncClientHttp";

export type StocksMatrixRow = {
  nmId: number;
  stockDate: string;
  quantity: number;
};

export async function fetchStocksMatrix(): Promise<StocksMatrixRow[]> {
  const response = await apiClient.get<StocksMatrixRow[]>(
    "/wb-clusters/products/stocks-matrix",
  );
  return Array.isArray(response.data) ? response.data : [];
}
