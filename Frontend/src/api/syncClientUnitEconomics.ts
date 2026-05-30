import { apiClient, buildWbClustersWriteHeaders } from "./syncClientHttp";

// ─── Настройки юнит-экономики ────────────────────────────────────────────────

export type UnitEconomicsCategorySetting = {
  category: string;
  commissionPercent: number | null;
};

export type UnitEconomicsSettings = {
  categories: UnitEconomicsCategorySetting[];
  acquiringPercent: number | null;
};

export async function fetchUnitEconomicsSettings(): Promise<UnitEconomicsSettings> {
  const response = await apiClient.get<UnitEconomicsSettings>(
    "/wb-clusters/unit-economics/settings",
  );
  return response.data ?? { categories: [], acquiringPercent: null };
}

export async function saveCategoryCommission(
  category: string,
  commissionPercent: number,
): Promise<void> {
  await apiClient.put(
    "/wb-clusters/unit-economics/category-commission",
    { category, commissionPercent },
    { headers: buildWbClustersWriteHeaders() },
  );
}

export async function clearCategoryCommission(category: string): Promise<void> {
  await apiClient.delete("/wb-clusters/unit-economics/category-commission", {
    params: { category },
    headers: buildWbClustersWriteHeaders(),
  });
}

export async function saveAcquiringPercent(acquiringPercent: number | null): Promise<void> {
  await apiClient.put(
    "/wb-clusters/unit-economics/acquiring",
    { acquiringPercent },
    { headers: buildWbClustersWriteHeaders() },
  );
}

// ─── Комиссия/эквайринг в ₽ на товар (колонки таблицы юнит-экономики) ─────────

export type UnitEconomicsChargeItem = {
  nmId: number;
  commissionRub: number | null;
  acquiringRub: number | null;
};

export async function fetchUnitEconomicsCharges(): Promise<UnitEconomicsChargeItem[]> {
  const response = await apiClient.get<{ items: UnitEconomicsChargeItem[] }>(
    "/wb-clusters/unit-economics/charges",
  );
  return response.data?.items ?? [];
}
