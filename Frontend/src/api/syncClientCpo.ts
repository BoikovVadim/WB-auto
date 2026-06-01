import { apiClient, matrixApiTimeoutMs } from "./syncClientHttp";

/**
 * Сегодняшний CPO (макс. цена за заказ) по товарам = (выручка / заказы) × ДРР%.
 * Считается на бэкенде, фронт только отображает. Значение есть, когда задан целевой ДРР,
 * есть выручка и заказы (>0). `revenue`/`orders` отдаются для взвешенного «Итого».
 */
export type TodayCpo = {
  nmId: number;
  cpo: number;
  revenue: number;
  orders: number;
};

export type TodayCpoResponse = {
  drrPercent: number | null;
  items: TodayCpo[];
};

export async function fetchTodayCpo(): Promise<TodayCpoResponse> {
  const response = await apiClient.get<TodayCpoResponse>(
    "/wb-clusters/products/cpo-today",
  );
  return response.data ?? { drrPercent: null, items: [] };
}

/**
 * Compact-матрица CPO: dates[] = дни окна выручки; на товар — cpo[i] (₽, ячейка) +
 * orders[i] (для взвешенного «Итого» = Σ(cpo×orders)/Σorders). Всё с бэкенда из выручки,
 * заказов и целевого ДРР; «сегодня» сюда не попадает — фронт рисует его live.
 */
export type CpoMatrixCompact = {
  drrPercent: number | null;
  dates: string[];
  products: {
    nmId: number;
    cpo: (number | null)[];
    revenue: (number | null)[];
    orders: (number | null)[];
  }[];
};

export async function fetchCpoMatrixCompact(): Promise<CpoMatrixCompact> {
  const response = await apiClient.get<CpoMatrixCompact>(
    "/wb-clusters/products/cpo-matrix-compact",
    { timeout: matrixApiTimeoutMs },
  );
  return response.data ?? { drrPercent: null, dates: [], products: [] };
}
