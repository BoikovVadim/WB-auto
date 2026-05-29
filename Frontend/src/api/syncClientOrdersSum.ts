import { apiClient } from "./syncClientHttp";

export type TodayOrdersSum = {
  nmId: number;
  ordersSum: number;
};

export async function fetchTodayOrdersSum(): Promise<TodayOrdersSum[]> {
  const response = await apiClient.get<{ items: TodayOrdersSum[] }>(
    "/wb-clusters/products/orders-sum-today",
  );
  return response.data?.items ?? [];
}

/**
 * Compact orders-sum matrix: dates[] shared across products, vals[i] = orders
 * sum (CSV/Analytics ordersSumRub) for products[k].nmId on dates[i].
 */
export type OrdersSumMatrixCompact = {
  dates: string[];
  products: { nmId: number; vals: (number | null)[] }[];
};

export async function fetchOrdersSumMatrixCompact(): Promise<OrdersSumMatrixCompact> {
  const response = await apiClient.get<OrdersSumMatrixCompact>(
    "/wb-clusters/products/orders-sum-matrix-compact",
  );
  return response.data ?? { dates: [], products: [] };
}
