import { apiClient, matrixApiTimeoutMs } from "./syncClientHttp";

/**
 * Потенциальная выручка за сегодня по товарам. Считается на бэкенде как
 * Сумма заказов × доля выкупа — фронт только отображает.
 */
export type TodayRevenue = {
  nmId: number;
  revenue: number;
};

export async function fetchTodayRevenue(): Promise<TodayRevenue[]> {
  const response = await apiClient.get<{ items: TodayRevenue[] }>(
    "/wb-clusters/products/revenue-today",
  );
  return response.data?.items ?? [];
}

/**
 * Compact revenue matrix: dates[] shared across products, vals[i] = выручка
 * (ordersSum × %выкупа за тот же день) для products[k].nmId на dates[i].
 * Считается на бэкенде, фронт рисует как есть.
 */
export type RevenueMatrixCompact = {
  dates: string[];
  products: { nmId: number; vals: (number | null)[] }[];
};

export async function fetchRevenueMatrixCompact(): Promise<RevenueMatrixCompact> {
  const response = await apiClient.get<RevenueMatrixCompact>(
    "/wb-clusters/products/revenue-matrix-compact",
    { timeout: matrixApiTimeoutMs },
  );
  return response.data ?? { dates: [], products: [] };
}
