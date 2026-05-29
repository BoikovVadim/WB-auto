import { useEffect, useRef, useState } from "react";

import {
  fetchRevenueMatrixCompact,
  type RevenueMatrixCompact,
} from "../../api/syncClientRevenue";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const CACHE_KEY = "wb_revenue_matrix_v1";
const CACHE_DATE_KEY = "wb_revenue_matrix_v1_date";

export type RevenueMatrix = {
  dates: string[];
  products: { nmId: number; values: (number | null)[] }[];
};

export type UseRevenueMatrixResult = {
  revenueMatrix: RevenueMatrix;
  isRevenueMatrixLoading: boolean;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(): RevenueMatrix | null {
  try {
    if (localStorage.getItem(CACHE_DATE_KEY) !== todayIso()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as RevenueMatrix) : null;
  } catch {
    return null;
  }
}

function writeCache(m: RevenueMatrix) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(CACHE_DATE_KEY, todayIso());
  } catch {
    /* quota */
  }
}

/** Compact server payload → local matrix; "today" column dropped (rendered live from revenueValues). */
function fromCompact(c: RevenueMatrixCompact): RevenueMatrix {
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

const EMPTY_MATRIX: RevenueMatrix = { dates: [], products: [] };

export function useRevenueMatrix(): UseRevenueMatrixResult {
  const [revenueMatrix, setRevenueMatrix] = useState<RevenueMatrix>(
    () => readCache() ?? EMPTY_MATRIX,
  );
  const [isRevenueMatrixLoading, setIsRevenueMatrixLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    const load = () => {
      setIsRevenueMatrixLoading(true);
      fetchRevenueMatrixCompact()
        .then((compact) => {
          if (!isMountedRef.current) return;
          const m = fromCompact(compact);
          setRevenueMatrix(m);
          writeCache(m);
        })
        .catch(() => {
          /* keep cached/previous values */
        })
        .finally(() => {
          if (isMountedRef.current) setIsRevenueMatrixLoading(false);
        });
    };
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  return { revenueMatrix, isRevenueMatrixLoading };
}
