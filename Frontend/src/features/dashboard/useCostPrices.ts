import { useCallback, useEffect, useRef, useState } from "react";

import { clearCostPrice, fetchAllCostPrices, saveCostPrice, type CostPriceCurrent } from "../../api/syncClientCostPrice";

export type { CostPriceCurrent };

export type UseCostPricesResult = {
  costPrices: Map<number, CostPriceCurrent>;
  isCostPricesLoading: boolean;
  prefetchCostPrices: () => void;
  handleCostSaved: (nmId: number, value: number) => Promise<void>;
  handleCostCleared: (nmIds: number[]) => Promise<void>;
};

const CACHE_KEY     = "wb_cost_prices_v2";
const CACHE_TS_KEY  = "wb_cost_prices_v2_ts";
const MAX_CACHE_AGE = 24 * 60 * 60 * 1000; // 24 hours

function readCache(): Map<number, CostPriceCurrent> {
  try {
    const ts = Number(localStorage.getItem(CACHE_TS_KEY) ?? "0");
    if (Date.now() - ts > MAX_CACHE_AGE) return new Map(); // stale — ignore
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return new Map();
    const items = JSON.parse(raw) as CostPriceCurrent[];
    const map = new Map<number, CostPriceCurrent>();
    for (const item of items) map.set(item.nmId, item);
    return map;
  } catch {
    return new Map();
  }
}

function writeCache(map: Map<number, CostPriceCurrent>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([...map.values()]));
    localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
  } catch {
    // localStorage quota exceeded — not critical
  }
}

export function useCostPrices(): UseCostPricesResult {
  // Initialise from localStorage immediately so values are visible on first render
  const [costPrices, setCostPrices] = useState<Map<number, CostPriceCurrent>>(() => readCache());
  const [isCostPricesLoading, setIsCostPricesLoading] = useState(false);
  const fetchedRef = useRef(false);
  const fetchingRef = useRef(false);

  const loadCostPrices = useCallback(() => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setIsCostPricesLoading(true);
    fetchAllCostPrices()
      .then((items) => {
        const map = new Map<number, CostPriceCurrent>();
        for (const item of items) map.set(item.nmId, item);
        setCostPrices(map);
        writeCache(map);
        fetchedRef.current = true;
      })
      .catch(() => {/* non-critical, cached values remain visible */})
      .finally(() => {
        fetchingRef.current = false;
        setIsCostPricesLoading(false);
      });
  }, []);

  const prefetchCostPrices = useCallback(() => {
    if (!fetchedRef.current && !fetchingRef.current) {
      loadCostPrices();
    }
  }, [loadCostPrices]);

  // Always load on mount to keep cache fresh
  useEffect(() => {
    loadCostPrices();
  }, [loadCostPrices]);

  const handleCostSaved = useCallback(async (nmId: number, value: number) => {
    await saveCostPrice(nmId, value);
    setCostPrices((prev) => {
      const next = new Map(prev);
      next.set(nmId, {
        nmId,
        costValue: value,
        effectiveDate: new Date().toISOString().slice(0, 10),
        updatedAt: new Date().toISOString(),
      });
      writeCache(next);
      return next;
    });
  }, []);

  const handleCostCleared = useCallback(async (nmIds: number[]) => {
    await Promise.all(nmIds.map((id) => clearCostPrice(id)));
    setCostPrices((prev) => {
      const next = new Map(prev);
      for (const id of nmIds) next.delete(id);
      writeCache(next);
      return next;
    });
  }, []);

  return { costPrices, isCostPricesLoading, prefetchCostPrices, handleCostSaved, handleCostCleared };
}
