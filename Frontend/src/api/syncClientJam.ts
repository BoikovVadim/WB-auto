import { apiClient, buildWbClustersWriteHeaders } from "./syncClientHttp";

export type JamPositionItem = {
  nmId: number;
  avgPosition: number | null;
  bestPosition: number | null;
  jamDate: string;
};

export type JamDailyRow = {
  nmId: number;
  jamDate: string;
  avgPosition: number | null;
  bestPosition: number | null;
  totalFrequency: number;
  topFrequency: number;
  totalClicks: number;
  totalAddToCart: number;
  totalOrders: number;
  queryCount: number;
};

export async function fetchLatestJamPositions(): Promise<JamPositionItem[]> {
  const response = await apiClient.get<{ items: JamPositionItem[] }>(
    "/wb-clusters/products/jam-positions",
  );
  return response.data?.items ?? [];
}

export async function fetchJamDailyMatrix(): Promise<JamDailyRow[]> {
  const response = await apiClient.get<JamDailyRow[]>(
    "/wb-clusters/products/jam-matrix",
  );
  return Array.isArray(response.data) ? response.data : [];
}

export type JamDailySummary = {
  avgPosition: number | null;
  bestPosition: number | null;
  totalFrequency: number;
  topFrequency: number;
  totalClicks: number;
  totalAddToCart: number;
  totalOrders: number;
  avgQueryCount: number;
  dayCount: number;
};

/** Summed JAM metrics for a single product over fromDate..toDate (YYYY-MM-DD). */
export async function fetchJamSummaryForProduct(
  nmId: number,
  fromDate: string,
  toDate: string,
): Promise<JamDailySummary | null> {
  const response = await apiClient.get<JamDailySummary | null>(
    `/wb-clusters/products/${String(nmId)}/jam-summary`,
    { params: { from: fromDate, to: toDate } },
  );
  return response.data ?? null;
}

/** Trigger JAM daily backfill for the entire current calendar month. */
export async function triggerJamBackfillMonth(): Promise<{ rowsWritten: number }> {
  const response = await apiClient.post<{ status: string; rowsWritten: number }>(
    "/wb-clusters/products/jam-backfill-month",
    undefined,
    { headers: buildWbClustersWriteHeaders() },
  );
  return { rowsWritten: response.data?.rowsWritten ?? 0 };
}
