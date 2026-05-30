import { useEffect, useRef, useState } from "react";

import {
  fetchDrrMatrixCompact,
  type DrrMatrixCompact,
} from "../../api/syncClientDrrPercent";

// История по дням меняется раз в сутки — 30 мин с запасом (лист грузится из кэша).
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

const CACHE_KEY = "wb_drr_matrix_v1";
const CACHE_DATE_KEY = "wb_drr_matrix_v1_date";

export type DrrMatrix = {
  dates: string[];
  products: {
    nmId: number;
    drr: (number | null)[];
    spend: (number | null)[];
    revenue: (number | null)[];
  }[];
};

export type UseDrrPercentMatrixResult = {
  drrMatrix: DrrMatrix;
  isDrrMatrixLoading: boolean;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(): DrrMatrix | null {
  try {
    if (localStorage.getItem(CACHE_DATE_KEY) !== todayIso()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as DrrMatrix) : null;
  } catch {
    return null;
  }
}

function writeCache(m: DrrMatrix) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(CACHE_DATE_KEY, todayIso());
  } catch {
    /* quota */
  }
}

/** Compact server payload → local matrix; "today" column dropped (rendered live from drrPercentValues). */
function fromCompact(c: DrrMatrixCompact): DrrMatrix {
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
    drr: keepIdx.map((i) => p.drr[i] ?? null),
    spend: keepIdx.map((i) => p.spend[i] ?? null),
    revenue: keepIdx.map((i) => p.revenue[i] ?? null),
  }));
  return { dates, products };
}

const EMPTY_MATRIX: DrrMatrix = { dates: [], products: [] };

export function useDrrPercentMatrix(enabled = true): UseDrrPercentMatrixResult {
  const [drrMatrix, setDrrMatrix] = useState<DrrMatrix>(() => readCache() ?? EMPTY_MATRIX);
  const [isDrrMatrixLoading, setIsDrrMatrixLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Грузим/поллим только при открытом листе ДРР (enabled) или в «Товарах»; кэш уже в стейте.
    if (!enabled) return;
    isMountedRef.current = true;
    const load = () => {
      setIsDrrMatrixLoading(true);
      fetchDrrMatrixCompact()
        .then((compact) => {
          if (!isMountedRef.current) return;
          const m = fromCompact(compact);
          setDrrMatrix(m);
          writeCache(m);
        })
        .catch(() => {
          /* keep cached/previous values */
        })
        .finally(() => {
          if (isMountedRef.current) setIsDrrMatrixLoading(false);
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

  return { drrMatrix, isDrrMatrixLoading };
}
