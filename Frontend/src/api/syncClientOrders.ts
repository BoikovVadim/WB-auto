import { apiClient } from "./syncClientHttp";

export type TodayOrderCount = {
  nmId: number;
  ordersCount: number;
  cancelledCount: number;
};

export type OrdersMatrixRow = {
  nmId: number;
  orderDate: string;
  ordersCount: number;
};

export async function fetchTodayOrderCounts(): Promise<TodayOrderCount[]> {
  const response = await apiClient.get<{ items: TodayOrderCount[] }>(
    "/wb-clusters/products/orders-today",
  );
  return response.data?.items ?? [];
}

export async function fetchOrdersMatrix(): Promise<OrdersMatrixRow[]> {
  const response = await apiClient.get<OrdersMatrixRow[]>(
    "/wb-clusters/products/orders-matrix",
  );
  return Array.isArray(response.data) ? response.data : [];
}
