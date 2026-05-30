import { apiClient, buildWbClustersWriteHeaders } from "./syncClientHttp";

// ─── Настройки юнит-экономики ────────────────────────────────────────────────

export type UnitEconomicsSubjectSetting = {
  subject: string;
  commissionPercent: number | null;
};

/** Глобальные %-метрики юнит-экономики (применяются ко всем товарам). */
export type GlobalPercentMetric = "acquiring" | "drr";

export type UnitEconomicsSettings = {
  subjects: UnitEconomicsSubjectSetting[];
  acquiringPercent: number | null;
  drrPercent: number | null;
};

export async function fetchUnitEconomicsSettings(): Promise<UnitEconomicsSettings> {
  const response = await apiClient.get<UnitEconomicsSettings>(
    "/wb-clusters/unit-economics/settings",
  );
  return response.data ?? { subjects: [], acquiringPercent: null, drrPercent: null };
}

export async function saveSubjectCommission(
  subject: string,
  commissionPercent: number,
): Promise<void> {
  await apiClient.put(
    "/wb-clusters/unit-economics/subject-commission",
    { subject, commissionPercent },
    { headers: buildWbClustersWriteHeaders() },
  );
}

export async function clearSubjectCommission(subject: string): Promise<void> {
  await apiClient.delete("/wb-clusters/unit-economics/subject-commission", {
    params: { subject },
    headers: buildWbClustersWriteHeaders(),
  });
}

export async function saveGlobalPercent(
  metric: GlobalPercentMetric,
  value: number | null,
): Promise<void> {
  await apiClient.put(
    `/wb-clusters/unit-economics/global-percent/${metric}`,
    { value },
    { headers: buildWbClustersWriteHeaders() },
  );
}

// ─── Комиссия/эквайринг в ₽ на товар (колонки таблицы юнит-экономики) ─────────

export type UnitEconomicsChargeItem = {
  nmId: number;
  commissionRub: number | null;
  acquiringRub: number | null;
  drrRub: number | null;
};

export async function fetchUnitEconomicsCharges(): Promise<UnitEconomicsChargeItem[]> {
  const response = await apiClient.get<{ items: UnitEconomicsChargeItem[] }>(
    "/wb-clusters/unit-economics/charges",
  );
  return response.data?.items ?? [];
}
