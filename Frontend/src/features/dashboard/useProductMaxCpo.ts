import { useEffect, useRef, useState } from "react";

import { fetchProductCpo } from "../../api/syncClientCpo";

// Выручка/заказы синкаются каждые 10 мин; планка CPO меняется не чаще.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export type UseProductMaxCpoResult = {
  /** Максимальная планка CPO товара (= CPO × 2, ₽). Считается на бэке. null — нет данных. */
  maxCpo: number | null;
};

/**
 * Планка CPO одного товара для шапки рекламного воркспейса. Грузит /products/:nmId/cpo,
 * когда выбран товар (nmId != null). ×2 уже применён на бэке — фронт только показывает.
 */
export function useProductMaxCpo(nmId: number | null): UseProductMaxCpoResult {
  const [maxCpo, setMaxCpo] = useState<number | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    if (nmId === null) {
      setMaxCpo(null);
      return;
    }
    const load = () => {
      fetchProductCpo(nmId)
        .then((res) => {
          if (isMountedRef.current) setMaxCpo(res.maxCpo);
        })
        .catch(() => {
          /* keep previous value */
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
  }, [nmId]);

  return { maxCpo };
}
