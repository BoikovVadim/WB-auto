import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTodayDrr } from "../../api/syncClientDrrPercent";

// 10 мин — расход и выручка синкаются каждые 10 мин; чаще ДРР пересчитывать не нужно.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export type UseDrrPercentResult = {
  /** Today's ДРР per nmId (ad spend / revenue × 100). Computed server-side. */
  drrPercentValues: Map<number, number>;
  isDrrPercentLoading: boolean;
  refreshDrrPercent: () => void;
};

export function useDrrPercent(): UseDrrPercentResult {
  const [drrPercentValues, setDrrPercentValues] = useState<Map<number, number>>(new Map());
  const [isDrrPercentLoading, setIsDrrPercentLoading] = useState(false);
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    setIsDrrPercentLoading(true);
    fetchTodayDrr()
      .then((items) => {
        if (!isMountedRef.current) return;
        setDrrPercentValues(new Map(items.map((o) => [o.nmId, o.drr])));
      })
      .catch(() => {
        /* keep previous values */
      })
      .finally(() => {
        if (isMountedRef.current) setIsDrrPercentLoading(false);
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

  return { drrPercentValues, isDrrPercentLoading, refreshDrrPercent: load };
}
