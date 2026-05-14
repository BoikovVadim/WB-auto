import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "wb-advertising-cluster-name-width-v1";
const MIN_WIDTH = 100;
const MAX_WIDTH = 700;

function clampClusterNameWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

export function useAdvertisingClusterNameWidthState() {
  const [clusterNameWidth, setClusterNameWidth] = useState<number | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (Number.isFinite(parsed) && parsed >= MIN_WIDTH) {
          setClusterNameWidth(clampClusterNameWidth(parsed));
        }
      }
    } catch {
      // localStorage недоступен — работаем без персистентной ширины
    }
  }, []);

  const handleClusterNameWidthChange = useCallback((width: number) => {
    const clamped = clampClusterNameWidth(width);
    setClusterNameWidth(clamped);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch {
      // игнорируем ошибки записи
    }
  }, []);

  return { clusterNameWidth, handleClusterNameWidthChange };
}
