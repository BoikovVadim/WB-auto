import { apiClient, buildWbClustersWriteHeaders } from "./syncClientHttp";

export type PricesMatrixRow = {
  nmId: number;
  priceDate: string;
  price: number;
  discount: number;
};

export type LatestPriceRow = {
  nmId: number;
  price: number;
  discount: number;
};

export async function fetchLatestPrices(): Promise<LatestPriceRow[]> {
  const response = await apiClient.get<LatestPriceRow[]>(
    "/wb-clusters/products/latest-prices",
  );
  return Array.isArray(response.data) ? response.data : [];
}

export async function fetchPricesMatrix(): Promise<PricesMatrixRow[]> {
  const response = await apiClient.get<PricesMatrixRow[]>(
    "/wb-clusters/products/prices-matrix",
  );
  return Array.isArray(response.data) ? response.data : [];
}

/** price × (1 − discount/100), 2 decimal places */
export function priceWithDiscount(price: number, discount: number): number {
  return Math.round(price * (1 - discount / 100) * 100) / 100;
}

// ─── Изменение цены с записью на маркетплейс WB ──────────────────────────────

export type PriceChangeSyncStatus =
  | "queued"
  | "sending"
  | "pending"
  | "throttled"
  | "confirmed"
  | "failed";

export type PriceChangeStatus = {
  nmId: number;
  desiredBasePrice: number;
  desiredDiscount: number;
  desiredFinal: number;
  syncStatus: PriceChangeSyncStatus;
  uploadId: number | null;
  confirmedAt: string | null;
  retryAt: string | null;
  lastError: string | null;
  attemptCount: number;
  updatedAt: string;
};

export type ApplyPriceResult = {
  nmId: number;
  status: "noop" | "sending" | "failed" | string;
  desiredBasePrice: number;
  desiredDiscount: number;
  desiredFinal: number;
  currentBasePrice: number;
  currentFinal: number;
  lastError: string | null;
};

/**
 * ⚠️ Запись цены на маркетплейс WB. `targetFinal` — желаемая цена «со скидкой»;
 * базу считает сервер, скидку не трогает. Отправляется только по явному вызову.
 */
export async function applyProductPrice(
  nmId: number,
  targetFinal: number,
): Promise<ApplyPriceResult> {
  const response = await apiClient.put<ApplyPriceResult>(
    `/wb-clusters/products/${String(nmId)}/price`,
    { targetFinal },
    { headers: buildWbClustersWriteHeaders() },
  );
  return response.data;
}

export async function fetchPriceChangeStatuses(): Promise<PriceChangeStatus[]> {
  const response = await apiClient.get<{ items: PriceChangeStatus[] }>(
    "/wb-clusters/products/price-change-statuses",
  );
  return response.data?.items ?? [];
}
