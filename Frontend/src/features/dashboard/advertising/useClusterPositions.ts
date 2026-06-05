import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import {
  fetchPositions,
  probeClusterPosition,
  type ClusterPositionLatest,
} from "../../../api/syncClientPositions";

/** Пауза между кластерами при глобальном обходе — щадящий темп для 1 IP. */
const RUN_ALL_GAP_MS = 3500;

const keyOf = (clusterName: string) => clusterName.trim().toLowerCase();

export type ClusterPositionContextValue = {
  getPosition: (clusterName: string) => ClusterPositionLatest | undefined;
  isProbing: (clusterName: string) => boolean;
  /** Замерить один кластер (по иконке в строке), fire-and-forget. */
  probeOne: (clusterName: string) => void;
  /** Глобальный обход в заданном порядке (текущая сортировка/экран). */
  runAll: (orderedClusterNames: string[]) => void;
  cancelAll: () => void;
  runningAll: boolean;
  progress: { done: number; total: number };
  /** Порядок видимых кластеров (заполняет секция из visibleClusterRows). */
  orderedClusterNames: string[];
};

export const ClusterPositionContext =
  createContext<ClusterPositionContextValue | null>(null);

export function usePositionContext(): ClusterPositionContextValue | null {
  return useContext(ClusterPositionContext);
}

export type UseClusterPositionsResult = Omit<
  ClusterPositionContextValue,
  "orderedClusterNames"
>;

/**
 * Стор позиций товара по кластерам: ключ — нормализованное имя кластера.
 * Грузит сохранённые снапшоты при заходе, умеет замерять один кластер и обходить все
 * последовательно (отменяемо). Место держится из снапшота до следующего ручного замера.
 */
export function useClusterPositions(nmId: number | null): UseClusterPositionsResult {
  const [positions, setPositions] = useState<Map<string, ClusterPositionLatest>>(
    new Map(),
  );
  const [probing, setProbing] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const cancelRef = useRef(false);

  useEffect(() => {
    if (nmId === null) return;
    let alive = true;
    void fetchPositions(nmId)
      .then((items) => {
        if (!alive) return;
        const map = new Map<string, ClusterPositionLatest>();
        for (const item of items) map.set(keyOf(item.clusterName), item);
        setPositions(map);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      cancelRef.current = true;
    };
  }, [nmId]);

  const probeOneAsync = useCallback(
    async (clusterName: string) => {
      if (nmId === null) return;
      const key = keyOf(clusterName);
      setProbing((prev) => new Set(prev).add(key));
      try {
        const snapshot = await probeClusterPosition(nmId, clusterName);
        setPositions((prev) => new Map(prev).set(key, snapshot));
      } catch {
        // оставляем прежнее значение ячейки
      } finally {
        setProbing((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [nmId],
  );

  const probeOne = useCallback(
    (clusterName: string) => void probeOneAsync(clusterName),
    [probeOneAsync],
  );

  const cancelAll = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const runAll = useCallback(
    (orderedClusterNames: string[]) => {
      if (nmId === null || orderedClusterNames.length === 0) return;
      cancelRef.current = false;
      setRunningAll(true);
      setProgress({ done: 0, total: orderedClusterNames.length });
      void (async () => {
        for (let i = 0; i < orderedClusterNames.length; i++) {
          if (cancelRef.current) break;
          await probeOneAsync(orderedClusterNames[i]!);
          setProgress({ done: i + 1, total: orderedClusterNames.length });
          if (i < orderedClusterNames.length - 1 && !cancelRef.current) {
            await new Promise((resolve) => setTimeout(resolve, RUN_ALL_GAP_MS));
          }
        }
        setRunningAll(false);
      })();
    },
    [nmId, probeOneAsync],
  );

  const getPosition = useCallback(
    (clusterName: string) => positions.get(keyOf(clusterName)),
    [positions],
  );
  const isProbing = useCallback(
    (clusterName: string) => probing.has(keyOf(clusterName)),
    [probing],
  );

  return { getPosition, isProbing, probeOne, runAll, cancelAll, runningAll, progress };
}
