import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearSubjectCommission,
  fetchUnitEconomicsSettings,
  saveSubjectCommission,
  saveGlobalPercent,
  type GlobalPercentMetric,
  type UnitEconomicsSettings,
} from "../../api/syncClientUnitEconomics";
import { cacheSessionJson, getCachedSessionJson } from "../../api/sessionJsonCache";

const SETTINGS_CACHE_KEY = "unit-economics-settings";

// Метрика → поле в settings (для оптимистичного обновления локального состояния).
const GLOBAL_METRIC_FIELD: Record<
  GlobalPercentMetric,
  "taxPercent" | "acquiringPercent" | "drrPercent"
> = {
  tax: "taxPercent",
  acquiring: "acquiringPercent",
  drr: "drrPercent",
};

export type UseUnitEconomicsSettingsResult = {
  settings: UnitEconomicsSettings;
  isLoading: boolean;
  /** Сохраняет комиссию предмета (null — очистить). Оптимистично + persist на бэке. */
  saveCommission: (subject: string, commissionPercent: number | null) => Promise<void>;
  /** Сохраняет глобальную %-метрику (эквайринг/ДРР; null — очистить). */
  saveGlobalMetric: (metric: GlobalPercentMetric, value: number | null) => Promise<void>;
};

const EMPTY: UnitEconomicsSettings = {
  subjects: [],
  taxPercent: null,
  acquiringPercent: null,
  drrPercent: null,
};

// Список предметов обновляем с той же периодичностью, что и каталог товаров
// (productCatalogRefreshTtlMs = 5 мин): добавился новый товар → его предмет
// появляется здесь сам, без перезагрузки. Значения комиссии берутся с бэка,
// поля в фокусе не перетираются (см. PercentInput).
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export function useUnitEconomicsSettings(
  onSaved?: () => void,
): UseUnitEconomicsSettingsResult {
  // Первый кадр из кэша (повторный заход/F5 — без ожидания сети), затем фоновая ревалидация.
  const cached = getCachedSessionJson<UnitEconomicsSettings>(SETTINGS_CACHE_KEY);
  const [settings, setSettings] = useState<UnitEconomicsSettings>(cached ?? EMPTY);
  const [isLoading, setIsLoading] = useState(false);
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    fetchUnitEconomicsSettings()
      .then((data) => {
        cacheSessionJson(SETTINGS_CACHE_KEY, data);
        if (isMountedRef.current) setSettings(data);
      })
      .catch(() => {
        /* оставляем прежние данные */
      })
      .finally(() => {
        if (isMountedRef.current) setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (getCachedSessionJson<UnitEconomicsSettings>(SETTINGS_CACHE_KEY) === null) {
      setIsLoading(true);
    }
    load();
    const interval = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [load]);

  const saveCommission = useCallback(
    async (subject: string, commissionPercent: number | null) => {
      if (commissionPercent === null) {
        await clearSubjectCommission(subject);
      } else {
        await saveSubjectCommission(subject, commissionPercent);
      }
      setSettings((prev) => ({
        ...prev,
        subjects: prev.subjects.map((s) =>
          s.subject === subject ? { ...s, commissionPercent } : s,
        ),
      }));
      onSaved?.();
    },
    [onSaved],
  );

  const saveGlobalMetric = useCallback(
    async (metric: GlobalPercentMetric, value: number | null) => {
      await saveGlobalPercent(metric, value);
      setSettings((prev) => ({ ...prev, [GLOBAL_METRIC_FIELD[metric]]: value }));
      onSaved?.();
    },
    [onSaved],
  );

  return { settings, isLoading, saveCommission, saveGlobalMetric };
}
