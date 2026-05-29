import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTodayOrdersSum } from "../../api/syncClientOrdersSum";

// 10 мин совпадает с каденцией синка «сегодня» из Воронки на бэкенде.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export type UseOrdersSumResult = {
  /** Today's orders sum (CSV ordersSumRub) per nmId. */
  ordersSumValues: Map<number, number>;
  isOrdersSumLoading: boolean;
  refreshOrdersSum: () => void;
};

export function useOrdersSum(): UseOrdersSumResult {
  const [ordersSumValues, setOrdersSumValues] = useState<Map<number, number>>(new Map());
  const [isOrdersSumLoading, setIsOrdersSumLoading] = useState(false);
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    setIsOrdersSumLoading(true);
    fetchTodayOrdersSum()
      .then((items) => {
        if (!isMountedRef.current) return;
        setOrdersSumValues(new Map(items.map((o) => [o.nmId, o.ordersSum])));
      })
      .catch(() => {
        /* keep previous values */
      })
      .finally(() => {
        if (isMountedRef.current) setIsOrdersSumLoading(false);
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

  return { ordersSumValues, isOrdersSumLoading, refreshOrdersSum: load };
}
