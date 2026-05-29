import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTodayCostSum } from "../../api/syncClientCostSum";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export type UseCostSumResult = {
  /** Today's «С/с продаж» (заказы × выкуп × себестоимость) per nmId. Computed server-side. */
  costSumValues: Map<number, number>;
  isCostSumLoading: boolean;
  refreshCostSum: () => void;
};

export function useCostSum(): UseCostSumResult {
  const [costSumValues, setCostSumValues] = useState<Map<number, number>>(new Map());
  const [isCostSumLoading, setIsCostSumLoading] = useState(false);
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    setIsCostSumLoading(true);
    fetchTodayCostSum()
      .then((items) => {
        if (!isMountedRef.current) return;
        setCostSumValues(new Map(items.map((o) => [o.nmId, o.costSum])));
      })
      .catch(() => {
        /* keep previous values */
      })
      .finally(() => {
        if (isMountedRef.current) setIsCostSumLoading(false);
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

  return { costSumValues, isCostSumLoading, refreshCostSum: load };
}
