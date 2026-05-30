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
// Транзиентный сбой загрузки (напр. 502 в окне рестарта после деплоя) раньше оставлял
// себестоимость пустой до remount — маржа/калькулятор «Юнит Экономики» не считались.
// Ретраим с backoff, пока не загрузим (≈2 мин суммарно).
const COST_MAX_RETRIES   = 8;
const COST_RETRY_BASE_MS = 2_000;
const COST_RETRY_MAX_MS  = 30_000;

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
  const retryAttemptsRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ссылка на сам загрузчик — чтобы ретрай в setTimeout не обращался к функции до её
  // объявления (стабильна, useCallback []).
  const loadRef = useRef<() => void>(() => {});

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
        retryAttemptsRef.current = 0;
      })
      .catch(() => {
        // Транзиентный сбой: ретраим с backoff (кэш остаётся виден всё это время).
        if (retryAttemptsRef.current < COST_MAX_RETRIES) {
          const delay = Math.min(
            COST_RETRY_MAX_MS,
            COST_RETRY_BASE_MS * 2 ** retryAttemptsRef.current,
          );
          retryAttemptsRef.current += 1;
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => loadRef.current(), delay);
        }
      })
      .finally(() => {
        fetchingRef.current = false;
        setIsCostPricesLoading(false);
      });
  }, []);

  useEffect(() => {
    loadRef.current = loadCostPrices;
  }, [loadCostPrices]);

  const prefetchCostPrices = useCallback(() => {
    if (!fetchedRef.current && !fetchingRef.current) {
      loadCostPrices();
    }
  }, [loadCostPrices]);

  // Always load on mount to keep cache fresh
  useEffect(() => {
    loadCostPrices();
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
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
