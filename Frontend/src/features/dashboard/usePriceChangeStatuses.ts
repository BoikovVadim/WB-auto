import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchPriceChangeStatuses,
  type PriceChangeStatus,
} from "../../api/syncClientPrices";

// Статусы меняются после reconcile-крона (раз в минуту) и сразу после применения,
// поэтому поллим почаще, чем дневные снапшоты, чтобы галочка появлялась быстро.
const REFRESH_INTERVAL_MS = 15 * 1000;

export type UsePriceChangeStatusesResult = {
  /** nmId → последний статус изменения цены (для индикатора-галочки). */
  priceChangeStatuses: Map<number, PriceChangeStatus>;
  refreshPriceChangeStatuses: () => void;
};

export function usePriceChangeStatuses(): UsePriceChangeStatusesResult {
  const [priceChangeStatuses, setPriceChangeStatuses] = useState<Map<number, PriceChangeStatus>>(
    new Map(),
  );
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    fetchPriceChangeStatuses()
      .then((items) => {
        if (!isMountedRef.current) return;
        setPriceChangeStatuses(new Map(items.map((s) => [s.nmId, s])));
      })
      .catch(() => {
        /* keep previous values */
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

  return { priceChangeStatuses, refreshPriceChangeStatuses: load };
}
