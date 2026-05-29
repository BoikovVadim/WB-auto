import { useEffect, useRef, useState } from "react";

import { fetchOrdersMatrixCompact, type OrdersMatrixCompact } from "../../api/syncClientOrders";

// История по дням меняется раз в сутки (после ночной сверки), поэтому 30 мин
// с запасом — лист всё равно грузится мгновенно из localStorage-кэша.
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

const CACHE_KEY = "wb_orders_matrix_v2";
const CACHE_DATE_KEY = "wb_orders_matrix_v2_date";

export type OrdersMatrix = {
  dates: string[];
  products: { nmId: number; values: (number | null)[] }[];
};

export type UseOrdersMatrixResult = {
  ordersMatrix: OrdersMatrix;
  isOrdersMatrixLoading: boolean;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(): OrdersMatrix | null {
  try {
    if (localStorage.getItem(CACHE_DATE_KEY) !== todayIso()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as OrdersMatrix) : null;
  } catch {
    return null;
  }
}

function writeCache(m: OrdersMatrix) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(CACHE_DATE_KEY, todayIso());
  } catch {
    /* quota */
  }
}

/** Compact server payload → local matrix; "today" column is dropped (rendered live from orderCounts). */
function fromCompact(c: OrdersMatrixCompact): OrdersMatrix {
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

const EMPTY_MATRIX: OrdersMatrix = { dates: [], products: [] };

/**
 * Preloads the full orders matrix (history by days) at dashboard bootstrap, so
 * the "Заказы" sheet opens instantly from memory. Mirrors useOrders shape.
 */
export function useOrdersMatrix(enabled = true): UseOrdersMatrixResult {
  const [ordersMatrix, setOrdersMatrix] = useState<OrdersMatrix>(() => readCache() ?? EMPTY_MATRIX);
  const [isOrdersMatrixLoading, setIsOrdersMatrixLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Грузим/поллим только когда лист «Заказы» открыт (enabled). Пока закрыт —
    // ни одного запроса; кэш из localStorage уже в стейте (useState-инициализатор),
    // поэтому при открытии лист показывается мгновенно и затем освежается.
    if (!enabled) return;
    isMountedRef.current = true;
    const load = () => {
      setIsOrdersMatrixLoading(true);
      fetchOrdersMatrixCompact()
        .then((compact) => {
          if (!isMountedRef.current) return;
          const m = fromCompact(compact);
          setOrdersMatrix(m);
          writeCache(m);
        })
        .catch(() => {
          // keep cached/previous values
        })
        .finally(() => {
          if (isMountedRef.current) setIsOrdersMatrixLoading(false);
        });
    };
    load();
    // Не поллим, пока вкладка скрыта.
    const interval = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [enabled]);

  return { ordersMatrix, isOrdersMatrixLoading };
}
