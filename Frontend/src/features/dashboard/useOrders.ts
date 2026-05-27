import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTodayOrderCounts, type TodayOrderCount } from "../../api/syncClientOrders";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export type UseOrdersResult = {
  orderCounts: Map<number, TodayOrderCount>;
  isOrdersLoading: boolean;
  refreshOrders: () => void;
};

/**
 * Loads today's order counts from the server.
 * No localStorage — business numbers are always fetched fresh.
 * Shows empty map while loading (no stale data).
 */
export function useOrders(): UseOrdersResult {
  const [orderCounts, setOrderCounts] = useState<Map<number, TodayOrderCount>>(new Map());
  const [isOrdersLoading, setIsOrdersLoading] = useState(false);
  const isMountedRef = useRef(true);

  const loadOrders = useCallback(() => {
    setIsOrdersLoading(true);
    fetchTodayOrderCounts()
      .then((items) => {
        if (!isMountedRef.current) return;
        setOrderCounts(new Map(items.map((o) => [o.nmId, o])));
      })
      .catch(() => {
        // Server unavailable — keep showing last successfully loaded values
      })
      .finally(() => {
        if (isMountedRef.current) setIsOrdersLoading(false);
      });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    loadOrders();
    const interval = setInterval(loadOrders, REFRESH_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [loadOrders]);

  return { orderCounts, isOrdersLoading, refreshOrders: loadOrders };
}
