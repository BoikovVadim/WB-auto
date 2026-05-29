import { useCallback, useEffect, useRef, useState } from "react";

import { fetchTodaySpp } from "../../api/syncClientSpp";

// Сегодняшнюю СПП бэкенд освежает 6-часовым кроном; 10 мин поллинга с запасом.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export type UseSppResult = {
  /** Today's средняя СПП (%) per nmId. Computed/stored server-side. */
  sppValues: Map<number, number>;
  isSppLoading: boolean;
  refreshSpp: () => void;
};

export function useSpp(): UseSppResult {
  const [sppValues, setSppValues] = useState<Map<number, number>>(new Map());
  const [isSppLoading, setIsSppLoading] = useState(false);
  const isMountedRef = useRef(true);

  const load = useCallback(() => {
    setIsSppLoading(true);
    fetchTodaySpp()
      .then((items) => {
        if (!isMountedRef.current) return;
        setSppValues(new Map(items.map((o) => [o.nmId, o.spp])));
      })
      .catch(() => {
        /* keep previous values */
      })
      .finally(() => {
        if (isMountedRef.current) setIsSppLoading(false);
      });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    load();
    const interval = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [load]);

  return { sppValues, isSppLoading, refreshSpp: load };
}
