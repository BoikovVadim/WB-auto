import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTodayCpo } from "../../api/syncClientCpo";

// 10 мин — выручка и заказы синкаются каждые 10 мин; чаще CPO пересчитывать не нужно.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export type UseCpoResult = {
  /** Today's CPO per nmId ((выручка / заказы) × ДРР%). Computed server-side. */
  cpoValues: Map<number, number>;
  isCpoLoading: boolean;
  refreshCpo: () => void;
};

export function useCpo(): UseCpoResult {
  const [cpoValues, setCpoValues] = useState<Map<number, number>>(new Map());
  const [isCpoLoading, setIsCpoLoading] = useState(false);
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    setIsCpoLoading(true);
    fetchTodayCpo()
      .then((res) => {
        if (!isMountedRef.current) return;
        setCpoValues(new Map(res.items.map((o) => [o.nmId, o.cpo])));
      })
      .catch(() => {
        /* keep previous values */
      })
      .finally(() => {
        if (isMountedRef.current) setIsCpoLoading(false);
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

  return { cpoValues, isCpoLoading, refreshCpo: load };
}
