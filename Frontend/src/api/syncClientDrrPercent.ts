import { apiClient, matrixApiTimeoutMs } from "./syncClientHttp";

/**
 * Сегодняшний ДРР (доля рекламных расходов) по товарам: расход на рекламу / выручка × 100.
 * Считается на бэкенде (числитель — расход, знаменатель — выручка), фронт только отображает.
 * Значение приходит только для товаров, у кого есть И расход, И выручка за сегодня.
 */
export type TodayDrr = {
  nmId: number;
  drr: number;
};

export async function fetchTodayDrr(): Promise<TodayDrr[]> {
  const response = await apiClient.get<{ items: TodayDrr[] }>(
    "/wb-clusters/products/drr-today",
  );
  return response.data?.items ?? [];
}

/**
 * Compact-матрица ДРР: dates[] общие для всех товаров; на товар — параллельные массивы:
 * drr[i] (%, для отображения ячейки) + spend[i]/revenue[i] (₽, для ВЗВЕШЕННОГО «Итого»
 * по столбцу = Σspend / Σrevenue × 100). Всё считается на бэкенде из расхода и выручки;
 * «сегодня» сюда не попадает (нет снапшота % выкупа за сегодня) — фронт рисует его live.
 */
export type DrrMatrixCompact = {
  dates: string[];
  products: {
    nmId: number;
    drr: (number | null)[];
    spend: (number | null)[];
    revenue: (number | null)[];
  }[];
};

export async function fetchDrrMatrixCompact(): Promise<DrrMatrixCompact> {
  const response = await apiClient.get<DrrMatrixCompact>(
    "/wb-clusters/products/drr-matrix-compact",
    { timeout: matrixApiTimeoutMs },
  );
  return response.data ?? { dates: [], products: [] };
}
