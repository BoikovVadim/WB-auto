import { useEffect, useRef, useState } from "react";

import {
  fetchSppMatrixCompact,
  type SppMatrixCompact,
} from "../../api/syncClientSpp";

// История по дням меняется раз в сутки — 30 мин с запасом (лист грузится из кэша).
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

const CACHE_KEY = "wb_spp_matrix_v1";
const CACHE_DATE_KEY = "wb_spp_matrix_v1_date";

export type SppMatrix = {
  dates: string[];
  products: { nmId: number; values: (number | null)[] }[];
};

export type UseSppMatrixResult = {
  sppMatrix: SppMatrix;
  isSppMatrixLoading: boolean;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(): SppMatrix | null {
  try {
    if (localStorage.getItem(CACHE_DATE_KEY) !== todayIso()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as SppMatrix) : null;
  } catch {
    return null;
  }
}

function writeCache(m: SppMatrix) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(CACHE_DATE_KEY, todayIso());
  } catch {
    /* quota */
  }
}

/** Compact server payload → local matrix; "today" column dropped (rendered live from sppValues). */
function fromCompact(c: SppMatrixCompact): SppMatrix {
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

const EMPTY_MATRIX: SppMatrix = { dates: [], products: [] };

export function useSppMatrix(enabled = true): UseSppMatrixResult {
  const [sppMatrix, setSppMatrix] = useState<SppMatrix>(
    () => readCache() ?? EMPTY_MATRIX,
  );
  const [isSppMatrixLoading, setIsSppMatrixLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Грузим/поллим только при открытом листе СПП (enabled); кэш уже в стейте.
    if (!enabled) return;
    isMountedRef.current = true;
    const load = () => {
      setIsSppMatrixLoading(true);
      fetchSppMatrixCompact()
        .then((compact) => {
          if (!isMountedRef.current) return;
          const m = fromCompact(compact);
          setSppMatrix(m);
          writeCache(m);
        })
        .catch(() => {
          /* keep cached/previous values */
        })
        .finally(() => {
          if (isMountedRef.current) setIsSppMatrixLoading(false);
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

  return { sppMatrix, isSppMatrixLoading };
}
