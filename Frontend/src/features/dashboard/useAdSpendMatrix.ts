import { useEffect, useRef, useState } from "react";

import {
  fetchAdSpendMatrixCompact,
  type AdSpendMatrixCompact,
} from "../../api/syncClientAdSpend";

// История по дням меняется раз в сутки — 30 мин с запасом (лист грузится из кэша).
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

const CACHE_KEY = "wb_ad_spend_matrix_v1";
const CACHE_DATE_KEY = "wb_ad_spend_matrix_v1_date";

export type AdSpendMatrix = {
  dates: string[];
  products: { nmId: number; values: (number | null)[] }[];
};

export type UseAdSpendMatrixResult = {
  adSpendMatrix: AdSpendMatrix;
  isAdSpendMatrixLoading: boolean;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(): AdSpendMatrix | null {
  try {
    if (localStorage.getItem(CACHE_DATE_KEY) !== todayIso()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as AdSpendMatrix) : null;
  } catch {
    return null;
  }
}

function writeCache(m: AdSpendMatrix) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(CACHE_DATE_KEY, todayIso());
  } catch {
    /* quota */
  }
}

/** Compact server payload → local matrix; "today" column dropped (rendered live from adSpendValues). */
function fromCompact(c: AdSpendMatrixCompact): AdSpendMatrix {
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

const EMPTY_MATRIX: AdSpendMatrix = { dates: [], products: [] };

export function useAdSpendMatrix(enabled = true): UseAdSpendMatrixResult {
  const [adSpendMatrix, setAdSpendMatrix] = useState<AdSpendMatrix>(
    () => readCache() ?? EMPTY_MATRIX,
  );
  const [isAdSpendMatrixLoading, setIsAdSpendMatrixLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Грузим/поллим только при открытом листе «Расходы на рекламу» (enabled); кэш уже в стейте.
    if (!enabled) return;
    isMountedRef.current = true;
    const load = () => {
      setIsAdSpendMatrixLoading(true);
      fetchAdSpendMatrixCompact()
        .then((compact) => {
          if (!isMountedRef.current) return;
          const m = fromCompact(compact);
          setAdSpendMatrix(m);
          writeCache(m);
        })
        .catch(() => {
          /* keep cached/previous values */
        })
        .finally(() => {
          if (isMountedRef.current) setIsAdSpendMatrixLoading(false);
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

  return { adSpendMatrix, isAdSpendMatrixLoading };
}
