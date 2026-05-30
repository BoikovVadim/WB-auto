import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearCategoryCommission,
  fetchUnitEconomicsSettings,
  saveCategoryCommission,
  saveGlobalPercent,
  type GlobalPercentMetric,
  type UnitEconomicsSettings,
} from "../../api/syncClientUnitEconomics";

// Метрика → поле в settings (для оптимистичного обновления локального состояния).
const GLOBAL_METRIC_FIELD: Record<GlobalPercentMetric, "acquiringPercent" | "drrPercent"> = {
  acquiring: "acquiringPercent",
  drr: "drrPercent",
};

export type UseUnitEconomicsSettingsResult = {
  settings: UnitEconomicsSettings;
  isLoading: boolean;
  /** Сохраняет комиссию категории (null — очистить). Оптимистично + persist на бэке. */
  saveCommission: (category: string, commissionPercent: number | null) => Promise<void>;
  /** Сохраняет глобальную %-метрику (эквайринг/ДРР; null — очистить). */
  saveGlobalMetric: (metric: GlobalPercentMetric, value: number | null) => Promise<void>;
};

const EMPTY: UnitEconomicsSettings = { categories: [], acquiringPercent: null, drrPercent: null };

// Список категорий обновляем с той же периодичностью, что и каталог товаров
// (productCatalogRefreshTtlMs = 5 мин): добавился новый товар → его категория
// появляется здесь сама, без перезагрузки. Значения комиссии берутся с бэка,
// поля в фокусе не перетираются (см. PercentInput).
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export function useUnitEconomicsSettings(
  onSaved?: () => void,
): UseUnitEconomicsSettingsResult {
  const [settings, setSettings] = useState<UnitEconomicsSettings>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    fetchUnitEconomicsSettings()
      .then((data) => {
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
    setIsLoading(true);
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
    async (category: string, commissionPercent: number | null) => {
      if (commissionPercent === null) {
        await clearCategoryCommission(category);
      } else {
        await saveCategoryCommission(category, commissionPercent);
      }
      setSettings((prev) => ({
        ...prev,
        categories: prev.categories.map((c) =>
          c.category === category ? { ...c, commissionPercent } : c,
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
