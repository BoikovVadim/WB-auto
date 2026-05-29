import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTodayRevenue } from "../../api/syncClientRevenue";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export type UseRevenueResult = {
  /** Today's potential revenue (ordersSum × buyout%) per nmId. Computed server-side. */
  revenueValues: Map<number, number>;
  isRevenueLoading: boolean;
  refreshRevenue: () => void;
};

export function useRevenue(): UseRevenueResult {
  const [revenueValues, setRevenueValues] = useState<Map<number, number>>(new Map());
  const [isRevenueLoading, setIsRevenueLoading] = useState(false);
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    setIsRevenueLoading(true);
    fetchTodayRevenue()
      .then((items) => {
        if (!isMountedRef.current) return;
        setRevenueValues(new Map(items.map((o) => [o.nmId, o.revenue])));
      })
      .catch(() => {
        /* keep previous values */
      })
      .finally(() => {
        if (isMountedRef.current) setIsRevenueLoading(false);
      });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [load]);

  return { revenueValues, isRevenueLoading, refreshRevenue: load };
}
