import { useEffect, useRef, useState } from "react";

import {
  fetchOrdersSumMatrixCompact,
  type OrdersSumMatrixCompact,
} from "../../api/syncClientOrdersSum";

// История по дням меняется раз в сутки — 30 мин с запасом (лист грузится из кэша).
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

const CACHE_KEY = "wb_orders_sum_matrix_v2";
const CACHE_DATE_KEY = "wb_orders_sum_matrix_v2_date";

export type OrdersSumMatrix = {
  dates: string[];
  products: { nmId: number; values: (number | null)[] }[];
};

export type UseOrdersSumMatrixResult = {
  ordersSumMatrix: OrdersSumMatrix;
  isOrdersSumMatrixLoading: boolean;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(): OrdersSumMatrix | null {
  try {
    if (localStorage.getItem(CACHE_DATE_KEY) !== todayIso()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as OrdersSumMatrix) : null;
  } catch {
    return null;
  }
}

function writeCache(m: OrdersSumMatrix) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(CACHE_DATE_KEY, todayIso());
  } catch {
    /* quota */
  }
}

/** Compact server payload → local matrix; "today" column dropped (rendered live from ordersSumValues). */
function fromCompact(c: OrdersSumMatrixCompact): OrdersSumMatrix {
  const today = todayIso();
  const keepIdx: number[] = [];
  const dates: string[] = [];
  for (let i = 0; i < c.dates.length; i++) {
    if (c.dates[i] !== today) {
      keepIdx.push(i);
      dates.push(c.dates[i]!);
    }
  }
  const products = c.products.map((p) => ({
    nmId: p.nmId,
    values: keepIdx.map((i) => p.vals[i] ?? null),
  }));
  return { dates, products };
}

const EMPTY_MATRIX: OrdersSumMatrix = { dates: [], products: [] };

export function useOrdersSumMatrix(enabled = true): UseOrdersSumMatrixResult {
  const [ordersSumMatrix, setOrdersSumMatrix] = useState<OrdersSumMatrix>(
    () => readCache() ?? EMPTY_MATRIX,
  );
  const [isOrdersSumMatrixLoading, setIsOrdersSumMatrixLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Грузим/поллим только при открытом листе «Сумма заказов» (enabled); кэш уже в стейте.
    if (!enabled) return;
    isMountedRef.current = true;
    const load = () => {
      setIsOrdersSumMatrixLoading(true);
      fetchOrdersSumMatrixCompact()
        .then((compact) => {
          if (!isMountedRef.current) return;
          const m = fromCompact(compact);
          setOrdersSumMatrix(m);
          writeCache(m);
        })
        .catch(() => {
          /* keep cached/previous values */
        })
        .finally(() => {
          if (isMountedRef.current) setIsOrdersSumMatrixLoading(false);
        });
    };
    load();
    const interval = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [enabled]);

  return { ordersSumMatrix, isOrdersSumMatrixLoading };
}
