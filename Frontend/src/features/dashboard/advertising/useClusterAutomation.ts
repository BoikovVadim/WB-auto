import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchClusterAutomationStatus,
  setClusterAutomationMode,
  type AutomationMode,
  type ClusterAutomationStatus,
} from "../../../api/syncClientClusterAutomation";

// Движок крутится кроном каждые 10 мин; статус освежаем с тем же интервалом.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

const EMPTY: ClusterAutomationStatus = { mode: "off", maxCpo: null, clusters: [] };

export type UseClusterAutomationResult = {
  status: ClusterAutomationStatus;
  isBusy: boolean;
  setMode: (mode: AutomationMode) => Promise<void>;
};

/**
 * Статус и управление автоматизацией кластеров по CPO для (nmId, advertId).
 * setMode — оптимистично меняет режим, шлёт на бэк, синхронизируется ответом.
 */
export function useClusterAutomation(
  nmId: number | null,
  advertId: number | null,
): UseClusterAutomationResult {
  const [status, setStatus] = useState<ClusterAutomationStatus>(EMPTY);
  const [isBusy, setIsBusy] = useState(false);
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    if (nmId === null || advertId === null) {
      setStatus(EMPTY);
      return;
    }
    fetchClusterAutomationStatus(nmId, advertId)
      .then((s) => {
        if (isMountedRef.current) setStatus(s);
      })
      .catch(() => {
        /* keep previous */
      });
  }, [nmId, advertId]);

  useEffect(() => {
    isMountedRef.current = true;
    load();
    const interval = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [load]);

  const setMode = useCallback(
    async (mode: AutomationMode) => {
      if (nmId === null || advertId === null) return;
      const prev = status;
      setStatus((s) => ({ ...s, mode })); // optimistic
      setIsBusy(true);
      try {
        const next = await setClusterAutomationMode(nmId, advertId, mode);
        if (isMountedRef.current) setStatus(next);
      } catch {
        if (isMountedRef.current) setStatus(prev); // rollback
      } finally {
        if (isMountedRef.current) setIsBusy(false);
      }
    },
    [nmId, advertId, status],
  );

  return { status, isBusy, setMode };
}
