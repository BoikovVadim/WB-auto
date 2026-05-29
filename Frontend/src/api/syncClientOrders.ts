import { apiClient, matrixApiTimeoutMs } from "./syncClientHttp";

export type TodayOrderCount = {
  nmId: number;
  ordersCount: number;
  cancelledCount: number;
};

export async function fetchTodayOrderCounts(): Promise<TodayOrderCount[]> {
  const response = await apiClient.get<{ items: TodayOrderCount[] }>(
    "/wb-clusters/products/orders-today",
  );
  return response.data?.items ?? [];
}

/**
 * Compact orders matrix: dates[] is shared across all products; vals[i] is the
 * orders count for products[k].nmId on dates[i]. Missing days are 0.
 * ~20x smaller payload than the legacy row-based format.
 */
export type OrdersMatrixCompact = {
  dates: string[];
  products: { nmId: number; vals: number[] }[];
};

export async function fetchOrdersMatrixCompact(): Promise<OrdersMatrixCompact> {
  const response = await apiClient.get<OrdersMatrixCompact>(
    "/wb-clusters/products/orders-matrix-compact",
    { timeout: matrixApiTimeoutMs },
  );
  return response.data ?? { dates: [], products: [] };
}
