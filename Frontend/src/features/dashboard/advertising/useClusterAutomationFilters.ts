import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchClusterFilterConfig,
  setProtectedClusters as apiSetProtectedClusters,
  type ClusterFilterConfig,
  type ClusterFilterRow,
} from "../../../api/syncClientClusterAutomation";

const EMPTY: ClusterFilterConfig = { clusters: [] };

export type UseClusterAutomationFiltersResult = {
  config: ClusterFilterConfig;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  /** Полная замена набора защищённых кластеров (optimistic + ревалидация). */
  saveProtected: (protectedRows: ClusterFilterRow[]) => Promise<void>;
};

/**
 * Данные модалки «Настройка фильтров» для (nmId, advertId): список кластеров с CPO/статусом
 * и флагом защиты. saveProtected — оптимистично проставляет isProtected, шлёт PUT,
 * синхронизируется ответом, откатывается при ошибке.
 */
export function useClusterAutomationFilters(
  nmId: number | null,
  advertId: number | null,
): UseClusterAutomationFiltersResult {
  const [config, setConfig] = useState<ClusterFilterConfig>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    if (nmId === null || advertId === null) {
      setConfig(EMPTY);
      return;
    }
    setIsLoading(true);
    setError(null);
    fetchClusterFilterConfig(nmId, advertId)
      .then((c) => {
        if (isMountedRef.current) setConfig(c);
      })
      .catch((e: unknown) => {
        if (isMountedRef.current) setError((e as Error).message ?? "Ошибка загрузки");
      })
      .finally(() => {
        if (isMountedRef.current) setIsLoading(false);
      });
    return () => {
      isMountedRef.current = false;
    };
  }, [nmId, advertId]);

  const saveProtected = useCallback(
    async (protectedRows: ClusterFilterRow[]) => {
      if (nmId === null || advertId === null) return;
      const protectedKeys = new Set(protectedRows.map((r) => r.normalizedClusterName));
      const prev = config;
      // optimistic: пометить выбранные защищёнными
      setConfig((c) => ({
        clusters: c.clusters.map((row) => ({
          ...row,
          isProtected: protectedKeys.has(row.normalizedClusterName),
        })),
      }));
      setIsSaving(true);
      setError(null);
      try {
        const next = await apiSetProtectedClusters(
          nmId,
          advertId,
          protectedRows.map((r) => ({
            normalizedClusterName: r.normalizedClusterName,
            clusterName: r.clusterName,
          })),
        );
        if (isMountedRef.current) setConfig(next);
      } catch (e: unknown) {
        if (isMountedRef.current) {
          setConfig(prev); // rollback
          setError((e as Error).message ?? "Ошибка сохранения");
        }
        throw e;
      } finally {
        if (isMountedRef.current) setIsSaving(false);
      }
    },
    [nmId, advertId, config],
  );

  return { config, isLoading, isSaving, error, saveProtected };
}
