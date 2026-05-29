import { apiClient, matrixApiTimeoutMs } from "./syncClientHttp";

/**
 * Сегодняшний расход на рекламу по товарам — сумма spend по всем кампаниям/кластерам
 * за сегодня (МСК). Считается на бэкенде из wb_cluster_daily_stats, фронт отображает.
 */
export type TodayAdSpend = {
  nmId: number;
  spend: number;
};

export async function fetchTodayAdSpend(): Promise<TodayAdSpend[]> {
  const response = await apiClient.get<{ items: TodayAdSpend[] }>(
    "/wb-clusters/products/ad-spend-today",
  );
  return response.data?.items ?? [];
}

/**
 * Compact-матрица расхода на рекламу: dates[] общие для всех товаров, vals[i] =
 * суммарный расход products[k].nmId на dates[i]. Агрегат на бэкенде из дневной
 * статистики; история копится по мере синка рекламы.
 */
export type AdSpendMatrixCompact = {
  dates: string[];
  products: { nmId: number; vals: (number | null)[] }[];
};

export async function fetchAdSpendMatrixCompact(): Promise<AdSpendMatrixCompact> {
  const response = await apiClient.get<AdSpendMatrixCompact>(
    "/wb-clusters/products/ad-spend-matrix-compact",
    { timeout: matrixApiTimeoutMs },
  );
  return response.data ?? { dates: [], products: [] };
}
