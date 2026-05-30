import { apiClient, buildWbClustersWriteHeaders } from "./syncClientHttp";

// ─── Настройки юнит-экономики ────────────────────────────────────────────────

export type UnitEconomicsSubjectSetting = {
  subject: string;
  commissionPercent: number | null;
};

/** Глобальные %-метрики юнит-экономики (применяются ко всем товарам). */
export type GlobalPercentMetric = "tax" | "acquiring" | "drr";

export type UnitEconomicsSettings = {
  subjects: UnitEconomicsSubjectSetting[];
  taxPercent: number | null;
  acquiringPercent: number | null;
  drrPercent: number | null;
};

export async function fetchUnitEconomicsSettings(): Promise<UnitEconomicsSettings> {
  const response = await apiClient.get<UnitEconomicsSettings>(
    "/wb-clusters/unit-economics/settings",
  );
  return response.data ?? { subjects: [], taxPercent: null, acquiringPercent: null, drrPercent: null };
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
  taxRub: number | null;
  commissionRub: number | null;
  acquiringRub: number | null;
  /** Применённый % эквайринга: факт за последнюю закрытую неделю или ручной глобальный %. */
  acquiringPercent: number | null;
  /** true — % из отчёта реализации (факт); false — подставлен ручной глобальный %. */
  acquiringIsFactual: boolean;
  drrRub: number | null;
  /** Маржа в ₽ на единицу (цена со скидкой − себестоимость − комиссия − эквайринг − ДРР). */
  marginRub: number | null;
  /** Маржа в % к цене со скидкой. */
  marginPercent: number | null;
};

export async function fetchUnitEconomicsCharges(): Promise<UnitEconomicsChargeItem[]> {
  const response = await apiClient.get<{ items: UnitEconomicsChargeItem[] }>(
    "/wb-clusters/unit-economics/charges",
  );
  return response.data?.items ?? [];
}

// ─── Ретроспектива эквайринга (товары × отчётные недели) ──────────────────────

export type AcquiringMatrix = {
  weeks: { start: string; end: string }[];
  products: {
    nmId: number;
    /** Средневзвешенный % эквайринга за неделю (null — продаж не было). */
    percents: (number | null)[];
    /** Σ эквайринга, ₽ за неделю — для взвешенного «Итого». */
    fees: number[];
    /** Σ розничной стоимости, ₽ за неделю — база взвешенного «Итого». */
    retails: number[];
  }[];
};

export async function fetchAcquiringMatrix(): Promise<AcquiringMatrix> {
  const response = await apiClient.get<AcquiringMatrix>(
    "/wb-clusters/unit-economics/acquiring-matrix",
  );
  return response.data ?? { weeks: [], products: [] };
}

// ─── Ретроспектива маржи (товары × даты, ₽ и %) ───────────────────────────────

export type MarginMatrix = {
  /** Сегодня (Москва) — первая дата в dates, считается на лету. */
  today: string;
  /** Даты DESC: dates[0] = today (live), остальные — закрытые дни снапшота. */
  dates: string[];
  products: {
    nmId: number;
    /** Маржа, ₽ на единицу за дату (null — нет с/с / нет данных за день). */
    marginRub: (number | null)[];
    /** Маржа, % к цене со скидкой за дату. */
    marginPercent: (number | null)[];
    /** Цена со скидкой за дату — база взвешенного «Итого, %». */
    priceWithDiscount: (number | null)[];
  }[];
};

export async function fetchMarginMatrix(): Promise<MarginMatrix> {
  const response = await apiClient.get<MarginMatrix>(
    "/wb-clusters/unit-economics/margin-matrix",
  );
  return response.data ?? { today: "", dates: [], products: [] };
}

// ─── Калькуляторы маржи/цены (на едином базисе колонки маржи, считает бэк) ─────

export type UnitEconomicsCalcInput = {
  /** Целевая маржа % → нужная цена со скидкой. */
  marginToPrice: { nmId: number; targetMarginPercent: number }[];
  /** Гипотетическая цена со скидкой → итоговая маржа %. */
  priceToMargin: { nmId: number; price: number }[];
};

export type UnitEconomicsCalcResult = {
  /** price — нужная цена со скидкой; feasible=false — маржа недостижима или нет с/с. */
  marginToPrice: { nmId: number; price: number | null; feasible: boolean }[];
  /** marginPercent — итоговая маржа %; null — нет с/с или цена ≤ 0. */
  priceToMargin: { nmId: number; marginPercent: number | null }[];
};

const EMPTY_CALC_RESULT: UnitEconomicsCalcResult = { marginToPrice: [], priceToMargin: [] };

export async function fetchUnitEconomicsCalc(
  input: UnitEconomicsCalcInput,
): Promise<UnitEconomicsCalcResult> {
  const response = await apiClient.post<UnitEconomicsCalcResult>(
    "/wb-clusters/unit-economics/calc",
    input,
  );
  return response.data ?? EMPTY_CALC_RESULT;
}

/** Ручной запуск синка эквайринга (fire-and-forget). days — глубина бэкфилла. */
export async function triggerAcquiringSync(days?: number): Promise<void> {
  await apiClient.post(
    "/wb-clusters/unit-economics/sync-acquiring",
    undefined,
    { params: days ? { days } : undefined, headers: buildWbClustersWriteHeaders() },
  );
}
