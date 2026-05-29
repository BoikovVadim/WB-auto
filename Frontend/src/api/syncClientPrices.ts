import { apiClient } from "./syncClientHttp";

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
