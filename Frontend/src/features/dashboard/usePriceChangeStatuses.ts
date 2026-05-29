import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchPriceChangeStatuses,
  type PriceChangeStatus,
} from "../../api/syncClientPrices";

// Адаптивный поллинг: пока есть незавершённые изменения (queued/sending/pending/
// throttled) — часто (2 с), чтобы галочка ✓ приходила почти сразу; иначе редко (20 с).
const FAST_INTERVAL_MS = 2 * 1000;
const IDLE_INTERVAL_MS = 20 * 1000;

const ACTIVE_STATUSES = new Set(["queued", "sending", "pending", "throttled"]);

export type UsePriceChangeStatusesResult = {
  /** nmId → последний статус изменения цены (для индикатора-галочки и цены в ячейке). */
  priceChangeStatuses: Map<number, PriceChangeStatus>;
  refreshPriceChangeStatuses: () => void;
  /** Оптимистично вставить/обновить статус (мгновенная фиксация цены в таблице). */
  upsertPriceChangeStatus: (status: PriceChangeStatus) => void;
};

export function usePriceChangeStatuses(): UsePriceChangeStatusesResult {
  const [priceChangeStatuses, setPriceChangeStatuses] = useState<Map<number, PriceChangeStatus>>(
    new Map(),
  );
  const isMountedRef = useRef(true);
  const statusesRef = useRef(priceChangeStatuses);
  useEffect(() => { statusesRef.current = priceChangeStatuses; }, [priceChangeStatuses]);

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

  const upsertPriceChangeStatus = useCallback((status: PriceChangeStatus) => {
    setPriceChangeStatuses((prev) => {
      const next = new Map(prev);
      next.set(status.nmId, status);
      return next;
    });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    load();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      load();
      const hasActive = Array.from(statusesRef.current.values()).some((s) =>
        ACTIVE_STATUSES.has(s.syncStatus),
      );
      timer = setTimeout(tick, hasActive ? FAST_INTERVAL_MS : IDLE_INTERVAL_MS);
    };
    timer = setTimeout(tick, IDLE_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      clearTimeout(timer);
    };
  }, [load]);

  return { priceChangeStatuses, refreshPriceChangeStatuses: load, upsertPriceChangeStatus };
}
