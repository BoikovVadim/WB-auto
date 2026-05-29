import { useCallback, useEffect, useRef, useState } from "react";

import { fetchLatestPrices, priceWithDiscount } from "../../api/syncClientPrices";

export type CurrentPriceEntry = {
  price: number;
  discount: number;
  priceWithDiscount: number;
};

export type UseCurrentPricesResult = {
  priceCounts: Map<number, CurrentPriceEntry>;
  isPricesLoading: boolean;
};

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export function useCurrentPrices(): UseCurrentPricesResult {
  const [priceCounts, setPriceCounts] = useState<Map<number, CurrentPriceEntry>>(new Map());
  const [isPricesLoading, setIsPricesLoading] = useState(false);
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    setIsPricesLoading(true);
    fetchLatestPrices()
      .then((rows) => {
        if (!isMountedRef.current) return;
        setPriceCounts(
          new Map(
            rows.map((r) => [
              r.nmId,
              {
                price: r.price,
                discount: r.discount,
                priceWithDiscount: priceWithDiscount(r.price, r.discount),
              },
            ]),
          ),
        );
      })
      .catch(() => { /* keep last values */ })
      .finally(() => {
        if (isMountedRef.current) setIsPricesLoading(false);
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

  return { priceCounts, isPricesLoading };
}
