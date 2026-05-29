import { useCallback, useEffect, useRef, useState } from "react";

import { fetchLatestStocks } from "../../api/syncClientStocks";

export type UseCurrentStocksResult = {
  stockCounts: Map<number, number>;
  isStocksLoading: boolean;
};

// Остатки — суточный снапшот (01:00 МСК); 10 мин поллинга с большим запасом.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export function useCurrentStocks(): UseCurrentStocksResult {
  const [stockCounts, setStockCounts] = useState<Map<number, number>>(new Map());
  const [isStocksLoading, setIsStocksLoading] = useState(false);
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    setIsStocksLoading(true);
    fetchLatestStocks()
      .then((rows) => {
        if (!isMountedRef.current) return;
        setStockCounts(new Map(rows.map((r) => [r.nmId, r.quantity])));
      })
      .catch(() => { /* keep last values */ })
      .finally(() => {
        if (isMountedRef.current) setIsStocksLoading(false);
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

  return { stockCounts, isStocksLoading };
}
