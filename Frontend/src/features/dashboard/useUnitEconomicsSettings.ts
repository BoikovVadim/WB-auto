import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearCategoryCommission,
  fetchUnitEconomicsSettings,
  saveAcquiringPercent,
  saveCategoryCommission,
  type UnitEconomicsSettings,
} from "../../api/syncClientUnitEconomics";

export type UseUnitEconomicsSettingsResult = {
  settings: UnitEconomicsSettings;
  isLoading: boolean;
  /** Сохраняет комиссию категории (null — очистить). Оптимистично + persist на бэке. */
  saveCommission: (category: string, commissionPercent: number | null) => Promise<void>;
  /** Сохраняет глобальный эквайринг (null — очистить). */
  saveAcquiring: (acquiringPercent: number | null) => Promise<void>;
};

const EMPTY: UnitEconomicsSettings = { categories: [], acquiringPercent: null };

export function useUnitEconomicsSettings(
  onSaved?: () => void,
): UseUnitEconomicsSettingsResult {
  const [settings, setSettings] = useState<UnitEconomicsSettings>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    setIsLoading(true);
    fetchUnitEconomicsSettings()
      .then((data) => {
        if (isMountedRef.current) setSettings(data);
      })
      .catch(() => {
        /* оставляем пусто — пользователь увидит загрузку без данных */
      })
      .finally(() => {
        if (isMountedRef.current) setIsLoading(false);
      });
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const saveAcquiring = useCallback(
    async (acquiringPercent: number | null) => {
      await saveAcquiringPercent(acquiringPercent);
      setSettings((prev) => ({ ...prev, acquiringPercent }));
      onSaved?.();
    },
    [onSaved],
  );

  return { settings, isLoading, saveCommission, saveAcquiring };
}
