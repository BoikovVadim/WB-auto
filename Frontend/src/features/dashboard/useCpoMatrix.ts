import { useEffect, useRef, useState } from "react";

import {
  fetchCpoMatrixCompact,
  type CpoMatrixCompact,
} from "../../api/syncClientCpo";

// История по дням меняется раз в сутки — 30 мин с запасом (лист грузится из кэша).
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

const CACHE_KEY = "wb_cpo_matrix_v1";
const CACHE_DATE_KEY = "wb_cpo_matrix_v1_date";

export type CpoMatrix = {
  dates: string[];
  products: {
    nmId: number;
    cpo: (number | null)[];
    /** Кол-во заказов за день — вес для взвешенного «Итого» = Σ(cpo×orders)/Σorders. */
    orders: (number | null)[];
  }[];
};

export type UseCpoMatrixResult = {
  cpoMatrix: CpoMatrix;
  isCpoMatrixLoading: boolean;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(): CpoMatrix | null {
  try {
    if (localStorage.getItem(CACHE_DATE_KEY) !== todayIso()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CpoMatrix) : null;
  } catch {
    return null;
  }
}

function writeCache(m: CpoMatrix) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(CACHE_DATE_KEY, todayIso());
  } catch {
    /* quota */
  }
}

/** Compact server payload → local matrix; "today" column dropped (rendered live from cpoValues). */
function fromCompact(c: CpoMatrixCompact): CpoMatrix {
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
    cpo: keepIdx.map((i) => p.cpo[i] ?? null),
    orders: keepIdx.map((i) => p.orders[i] ?? null),
  }));
  return { dates, products };
}

const EMPTY_MATRIX: CpoMatrix = { dates: [], products: [] };

export function useCpoMatrix(enabled = true): UseCpoMatrixResult {
  const [cpoMatrix, setCpoMatrix] = useState<CpoMatrix>(() => readCache() ?? EMPTY_MATRIX);
  const [isCpoMatrixLoading, setIsCpoMatrixLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Грузим/поллим только при открытом листе CPO (enabled) или в «Товарах»; кэш уже в стейте.
    if (!enabled) return;
    isMountedRef.current = true;
    const load = () => {
      setIsCpoMatrixLoading(true);
      fetchCpoMatrixCompact()
        .then((compact) => {
          if (!isMountedRef.current) return;
          const m = fromCompact(compact);
          setCpoMatrix(m);
          writeCache(m);
        })
        .catch(() => {
          /* keep cached/previous values */
        })
        .finally(() => {
          if (isMountedRef.current) setIsCpoMatrixLoading(false);
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

  return { cpoMatrix, isCpoMatrixLoading };
}
