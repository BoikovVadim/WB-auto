import { useEffect, useRef, useState } from "react";

import {
  fetchCostSumMatrixCompact,
  type CostSumMatrixCompact,
} from "../../api/syncClientCostSum";

// История по дням меняется раз в сутки — 30 мин с запасом (лист грузится из кэша).
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

const CACHE_KEY = "wb_cost_sum_matrix_v1";
const CACHE_DATE_KEY = "wb_cost_sum_matrix_v1_date";

export type CostSumMatrix = {
  dates: string[];
  products: { nmId: number; values: (number | null)[] }[];
};

export type UseCostSumMatrixResult = {
  costSumMatrix: CostSumMatrix;
  isCostSumMatrixLoading: boolean;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(): CostSumMatrix | null {
  try {
    if (localStorage.getItem(CACHE_DATE_KEY) !== todayIso()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CostSumMatrix) : null;
  } catch {
    return null;
  }
}

function writeCache(m: CostSumMatrix) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(CACHE_DATE_KEY, todayIso());
  } catch {
    /* quota */
  }
}

/** Compact server payload → local matrix; "today" column dropped (rendered live from costSumValues). */
function fromCompact(c: CostSumMatrixCompact): CostSumMatrix {
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

const EMPTY_MATRIX: CostSumMatrix = { dates: [], products: [] };

export function useCostSumMatrix(enabled = true): UseCostSumMatrixResult {
  const [costSumMatrix, setCostSumMatrix] = useState<CostSumMatrix>(
    () => readCache() ?? EMPTY_MATRIX,
  );
  const [isCostSumMatrixLoading, setIsCostSumMatrixLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Грузим/поллим только при открытом листе «С/с продаж» (enabled); кэш уже в стейте.
    if (!enabled) return;
    isMountedRef.current = true;
    const load = () => {
      setIsCostSumMatrixLoading(true);
      fetchCostSumMatrixCompact()
        .then((compact) => {
          if (!isMountedRef.current) return;
          const m = fromCompact(compact);
          setCostSumMatrix(m);
          writeCache(m);
        })
        .catch(() => {
          /* keep cached/previous values */
        })
        .finally(() => {
          if (isMountedRef.current) setIsCostSumMatrixLoading(false);
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

  return { costSumMatrix, isCostSumMatrixLoading };
}
