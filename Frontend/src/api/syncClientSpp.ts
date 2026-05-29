import { apiClient, matrixApiTimeoutMs } from "./syncClientHttp";

/**
 * СПП (средняя скидка постоянного покупателя) за сегодня по товарам — простое среднее
 * spp по всем заказам товара за день. spp приходит только из Statistics API; считается
 * и хранится на бэкенде (фронт читает готовые строки wb_product_spp_daily).
 */
export type TodaySpp = {
  nmId: number;
  spp: number;
};

export async function fetchTodaySpp(): Promise<TodaySpp[]> {
  const response = await apiClient.get<{ items: TodaySpp[] }>(
    "/wb-clusters/products/spp-today",
  );
  return response.data?.items ?? [];
}

/**
 * Compact-матрица СПП: dates[] общие для всех товаров, vals[i] = средняя СПП (%) для
 * products[k].nmId на dates[i]. Только закрытые дни (сегодня — pinned-колонка, live из
 * spp-today). Считается на бэкенде, копится вперёд + разовый backfill за неделю.
 */
export type SppMatrixCompact = {
  dates: string[];
  products: { nmId: number; vals: (number | null)[] }[];
};

export async function fetchSppMatrixCompact(): Promise<SppMatrixCompact> {
  const response = await apiClient.get<SppMatrixCompact>(
    "/wb-clusters/products/spp-matrix-compact",
    { timeout: matrixApiTimeoutMs },
  );
  return response.data ?? { dates: [], products: [] };
}
