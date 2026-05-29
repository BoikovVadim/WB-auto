import { apiClient } from "./syncClientHttp";

/**
 * «С/с продаж» за сегодня по товарам — себестоимость выкупленных заказов.
 * Считается на бэкенде как Заказы × доля выкупа × себестоимость за штуку —
 * фронт только отображает.
 */
export type TodayCostSum = {
  nmId: number;
  costSum: number;
};

export async function fetchTodayCostSum(): Promise<TodayCostSum[]> {
  const response = await apiClient.get<{ items: TodayCostSum[] }>(
    "/wb-clusters/products/cost-sum-today",
  );
  return response.data?.items ?? [];
}

/**
 * Compact-матрица «С/с продаж»: dates[] общие для всех товаров, vals[i] = С/с продаж
 * (заказы × %выкупа × себестоимость за тот же день) для products[k].nmId на dates[i].
 * Снапшот считается на бэкенде, стартует с момента запуска и копится вперёд.
 */
export type CostSumMatrixCompact = {
  dates: string[];
  products: { nmId: number; vals: (number | null)[] }[];
};

export async function fetchCostSumMatrixCompact(): Promise<CostSumMatrixCompact> {
  const response = await apiClient.get<CostSumMatrixCompact>(
    "/wb-clusters/products/cost-sum-matrix-compact",
  );
  return response.data ?? { dates: [], products: [] };
}
