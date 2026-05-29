import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchPriceChangeStatuses,
  type PriceChangeStatus,
} from "../../api/syncClientPrices";

// Overlay последних выставленных пользователем цен. Без периодического поллинга:
// постоянный re-render каждые N секунд заставлял виртуализатор переизмерять строки
// и колонка «дёргалась». Грузим один раз на маунте; в течение сессии обновляем
// оптимистично (upsert) и после сохранения (refresh).
export type UsePriceChangeStatusesResult = {
  /** nmId → последняя выставленная цена (overlay для ячейки «Цена»). */
  priceChangeStatuses: Map<number, PriceChangeStatus>;
  refreshPriceChangeStatuses: () => void;
  /** Оптимистично вставить/обновить значение (мгновенная фиксация цены в таблице). */
  upsertPriceChangeStatus: (status: PriceChangeStatus) => void;
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
    return () => {
      isMountedRef.current = false;
    };
  }, [load]);

  return { priceChangeStatuses, refreshPriceChangeStatuses: load, upsertPriceChangeStatus };
}
