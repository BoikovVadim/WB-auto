import { useCallback, useEffect, useRef, useState } from "react";

import { fetchUnitEconomicsCharges } from "../../api/syncClientUnitEconomics";

// Значения зависят от настроек (комиссия/эквайринг) и цен. Полминутный поллинг не
// нужен — рефрешим на маунте и явно после правки настроек (refreshCharges).
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export type UseUnitEconomicsChargesResult = {
  /** Налог в ₽ на товар (глобальный % × цена со скидкой). Считается на бэке. */
  taxValues: Map<number, number>;
  /** Комиссия в ₽ на товар (по категории × цена со скидкой). Считается на бэке. */
  commissionValues: Map<number, number>;
  /** Эквайринг в ₽ на товар (глобальный % × цена со скидкой). Считается на бэке. */
  acquiringValues: Map<number, number>;
  /** ДРР в ₽ на товар (глобальный % × цена со скидкой). Считается на бэке. */
  drrValues: Map<number, number>;
  /** Маржа в ₽ на единицу (цена со скидкой − с/с − комиссия − эквайринг − ДРР). Считается на бэке. */
  marginRubValues: Map<number, number>;
  /** Маржа в % к цене со скидкой. Считается на бэке. */
  marginPercentValues: Map<number, number>;
  refreshCharges: () => void;
};

export function useUnitEconomicsCharges(): UseUnitEconomicsChargesResult {
  const [taxValues, setTaxValues] = useState<Map<number, number>>(new Map());
  const [commissionValues, setCommissionValues] = useState<Map<number, number>>(new Map());
  const [acquiringValues, setAcquiringValues] = useState<Map<number, number>>(new Map());
  const [drrValues, setDrrValues] = useState<Map<number, number>>(new Map());
  const [marginRubValues, setMarginRubValues] = useState<Map<number, number>>(new Map());
  const [marginPercentValues, setMarginPercentValues] = useState<Map<number, number>>(new Map());
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    fetchUnitEconomicsCharges()
      .then((items) => {
        if (!isMountedRef.current) return;
        const tax = new Map<number, number>();
        const commission = new Map<number, number>();
        const acquiring = new Map<number, number>();
        const drr = new Map<number, number>();
        const marginRub = new Map<number, number>();
        const marginPercent = new Map<number, number>();
        for (const item of items) {
          if (item.taxRub !== null) tax.set(item.nmId, item.taxRub);
          if (item.commissionRub !== null) commission.set(item.nmId, item.commissionRub);
          if (item.acquiringRub !== null) acquiring.set(item.nmId, item.acquiringRub);
          if (item.drrRub !== null) drr.set(item.nmId, item.drrRub);
          if (item.marginRub !== null) marginRub.set(item.nmId, item.marginRub);
          if (item.marginPercent !== null) marginPercent.set(item.nmId, item.marginPercent);
        }
        setTaxValues(tax);
        setCommissionValues(commission);
        setAcquiringValues(acquiring);
        setDrrValues(drr);
        setMarginRubValues(marginRub);
        setMarginPercentValues(marginPercent);
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

  return {
    taxValues,
    commissionValues,
    acquiringValues,
    drrValues,
    marginRubValues,
    marginPercentValues,
    refreshCharges: load,
  };
}
