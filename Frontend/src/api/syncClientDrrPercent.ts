import { apiClient, matrixApiTimeoutMs } from "./syncClientHttp";

/**
 * Сегодняшний ДРР (доля рекламных расходов) по товарам: расход на рекламу / выручка × 100.
 * Считается на бэкенде (числитель — расход, знаменатель — выручка), фронт только отображает.
 * Значение приходит для товаров с расходом (>0); без выручки (нет заказов) ДРР = 100%.
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
 * Compact-матрица ДРР: dates[] = дни окна выручки; на товар — массивы drr[i] (%, ячейка) +
 * spend[i]/revenue[i] (₽). revenueTotals[i] — полная выручка магазина за день (знаменатель
 * «Итого» столбца = Σspend / revenueTotals × 100). Всё с бэкенда из расхода и выручки;
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
  revenueTotals: number[];
};

export async function fetchDrrMatrixCompact(): Promise<DrrMatrixCompact> {
  const response = await apiClient.get<DrrMatrixCompact>(
    "/wb-clusters/products/drr-matrix-compact",
    { timeout: matrixApiTimeoutMs },
  );
  return response.data ?? { dates: [], products: [], revenueTotals: [] };
}
