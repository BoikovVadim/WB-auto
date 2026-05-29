import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchRollingBuyoutCounts,
  fetchTodayBuyoutCounts,
  type TodayBuyoutCount,
} from "../../api/syncClientBuyouts";

// 10 мин совпадает с каденцией синка «сегодня» из Воронки на бэкенде.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export type UseBuyoutsResult = {
  /** Today's orders + buyouts per product. Used by the retrospective sheet. */
  buyoutCounts: Map<number, TodayBuyoutCount>;
  /**
   * Rolling 365-day aggregate (orders + buyouts) per product. Used by the
   * inline «% выкупа» column. WB's `buyoutsCount` already reflects cancels
   * and returns (recomputed retroactively), so the simple buyouts/orders
   * ratio is mathematically equivalent to (orders − cancels − returns)/orders
   * with no source-of-truth mismatch.
   */
  rollingBuyoutCounts: Map<number, TodayBuyoutCount>;
  isBuyoutsLoading: boolean;
  refreshBuyouts: () => void;
};

export function useBuyouts(): UseBuyoutsResult {
  const [buyoutCounts, setBuyoutCounts] = useState<Map<number, TodayBuyoutCount>>(new Map());
  const [rollingBuyoutCounts, setRollingBuyoutCounts] = useState<Map<number, TodayBuyoutCount>>(new Map());
  const [isBuyoutsLoading, setIsBuyoutsLoading] = useState(false);
  const isMountedRef = useRef(true);

  const loadBuyouts = useCallback(() => {
    setIsBuyoutsLoading(true);
    Promise.allSettled([fetchTodayBuyoutCounts(), fetchRollingBuyoutCounts()])
      .then(([todayRes, rollingRes]) => {
        if (!isMountedRef.current) return;
        if (todayRes.status === "fulfilled") {
          setBuyoutCounts(new Map(todayRes.value.map((o) => [o.nmId, o])));
        }
        if (rollingRes.status === "fulfilled") {
          setRollingBuyoutCounts(new Map(rollingRes.value.map((o) => [o.nmId, o])));
        }
      })
      .finally(() => {
        if (isMountedRef.current) setIsBuyoutsLoading(false);
      });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    loadBuyouts();
    const interval = setInterval(() => {
      if (!document.hidden) loadBuyouts();
    }, REFRESH_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [loadBuyouts]);

  return { buyoutCounts, rollingBuyoutCounts, isBuyoutsLoading, refreshBuyouts: loadBuyouts };
}
