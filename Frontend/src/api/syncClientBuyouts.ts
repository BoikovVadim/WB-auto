import { apiClient } from "./syncClientHttp";

export type TodayBuyoutCount = {
  nmId: number;
  ordersCount: number;
  buyoutsCount: number;
};

export async function fetchTodayBuyoutCounts(): Promise<TodayBuyoutCount[]> {
  const response = await apiClient.get<{ items: TodayBuyoutCount[] }>(
    "/wb-clusters/products/buyouts-today",
  );
  return response.data?.items ?? [];
}

/**
 * Rolling-window aggregate of orders + buyouts per product
 * (server: 365 days, ending today МСК). Used for the inline «% выкупа» column.
 * Formula: buyouts / orders × 100 — WB CSV `buyoutsCount` already accounts
 * for cancellations and returns (recomputed retroactively by WB).
 */
export async function fetchRollingBuyoutCounts(): Promise<TodayBuyoutCount[]> {
  const response = await apiClient.get<{ items: TodayBuyoutCount[] }>(
    "/wb-clusters/products/buyouts-rolling",
  );
  return response.data?.items ?? [];
}

/**
 * Compact snapshot matrix for the «% выкупа» retrospective sheet.
 * dates[] is shared across all products; percents[i] is rolling-365 % on dates[i].
 * Read from wb_product_buyout_daily_snapshot — accumulates one row per product per day.
 */
export type BuyoutSnapshotMatrix = {
  dates: string[];
  products: {
    nmId: number;
    percents: (number | null)[];
    /** orders/buyouts по тем же ячейкам — для взвешенного «Итого» (Σвыкупов/Σзаказов). */
    orders: number[];
    buyouts: number[];
  }[];
};

export async function fetchBuyoutSnapshotMatrix(): Promise<BuyoutSnapshotMatrix> {
  const response = await apiClient.get<BuyoutSnapshotMatrix>(
    "/wb-clusters/products/buyout-snapshot-matrix",
  );
  return response.data ?? { dates: [], products: [] };
}

