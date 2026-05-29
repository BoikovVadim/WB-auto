import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTodayAdSpend } from "../../api/syncClientAdSpend";

// 10 мин — расход на рекламу обновляется синком статистики; чаще не нужно.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export type UseAdSpendResult = {
  /** Today's total ad spend per nmId (SUM(spend) across campaigns). Computed server-side. */
  adSpendValues: Map<number, number>;
  isAdSpendLoading: boolean;
  refreshAdSpend: () => void;
};

export function useAdSpend(): UseAdSpendResult {
  const [adSpendValues, setAdSpendValues] = useState<Map<number, number>>(new Map());
  const [isAdSpendLoading, setIsAdSpendLoading] = useState(false);
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    setIsAdSpendLoading(true);
    fetchTodayAdSpend()
      .then((items) => {
        if (!isMountedRef.current) return;
        setAdSpendValues(new Map(items.map((o) => [o.nmId, o.spend])));
      })
      .catch(() => {
        /* keep previous values */
      })
      .finally(() => {
        if (isMountedRef.current) setIsAdSpendLoading(false);
      });
  }, []);

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

  return { adSpendValues, isAdSpendLoading, refreshAdSpend: load };
}
