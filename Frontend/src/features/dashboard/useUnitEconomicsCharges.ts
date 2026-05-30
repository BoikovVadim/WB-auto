import { useCallback, useEffect, useRef, useState } from "react";

import { fetchUnitEconomicsCharges } from "../../api/syncClientUnitEconomics";

// Значения зависят от настроек (комиссия/эквайринг) и цен. Полминутный поллинг не
// нужен — рефрешим на маунте и явно после правки настроек (refreshCharges).
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export type UseUnitEconomicsChargesResult = {
  /** Комиссия в ₽ на товар (по категории × цена со скидкой). Считается на бэке. */
  commissionValues: Map<number, number>;
  /** Эквайринг в ₽ на товар (глобальный % × цена со скидкой). Считается на бэке. */
  acquiringValues: Map<number, number>;
  refreshCharges: () => void;
};

export function useUnitEconomicsCharges(): UseUnitEconomicsChargesResult {
  const [commissionValues, setCommissionValues] = useState<Map<number, number>>(new Map());
  const [acquiringValues, setAcquiringValues] = useState<Map<number, number>>(new Map());
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    fetchUnitEconomicsCharges()
      .then((items) => {
        if (!isMountedRef.current) return;
        const commission = new Map<number, number>();
        const acquiring = new Map<number, number>();
        for (const item of items) {
          if (item.commissionRub !== null) commission.set(item.nmId, item.commissionRub);
          if (item.acquiringRub !== null) acquiring.set(item.nmId, item.acquiringRub);
        }
        setCommissionValues(commission);
        setAcquiringValues(acquiring);
      })
      .catch(() => {
        /* keep previous values */
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

  return { commissionValues, acquiringValues, refreshCharges: load };
}
