import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import {
  fetchPositions,
  triggerClusterProbe,
  type ClusterPositionLatest,
} from "../../../api/syncClientPositions";

/**
 * Базовая пауза между кластерами при глобальном обходе. Держим быстрый темп (тёплая
 * легитимная браузер-сессия выглядит как живой пользователь), но НЕ слепо: если WB вернул
 * throttled/blocked — gap самозащитно растёт до MAX (см. адаптацию в runAll), а на чистых
 * ответах возвращается к базовому. Так проверяем «WB не блокирует» без риска уйти в бан.
 */
const RUN_ALL_GAP_MS = 400;
/** Потолок самозащитного замедления при троттле WB. */
const RUN_ALL_MAX_GAP_MS = 4000;
/**
 * Расписание поллинга результата БД. Тёплый зонд отдаёт ~1с — поэтому первые пробы
 * частые (ловим результат за ~0.6с вместо прежних 3с). Если попали в холодный старт
 * (~75с прогрев + ретрай со сменой IP, до ~3 мин) — бэкофф разрежает пробы до 3с.
 */
const POLL_DELAYS_MS = [600, 600, 800, 1200, 1800];
const POLL_TAIL_MS = 3000;
const POLL_MAX_TRIES = 70;
const pollDelay = (tryIndex: number) => POLL_DELAYS_MS[tryIndex] ?? POLL_TAIL_MS;

const keyOf = (clusterName: string) => clusterName.trim().toLowerCase();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const buildMap = (items: ClusterPositionLatest[]) => {
  const map = new Map<string, ClusterPositionLatest>();
  for (const item of items) map.set(keyOf(item.clusterName), item);
  return map;
};

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
  // Зеркало позиций для чтения «было/стало» в поллинге без stale-замыкания.
  const positionsRef = useRef(positions);
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    if (nmId === null) return;
    let alive = true;
    void fetchPositions(nmId)
      .then((items) => {
        if (!alive) return;
        setPositions(buildMap(items));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      cancelRef.current = true;
    };
  }, [nmId]);

  const probeOneAsync = useCallback(
    async (clusterName: string): Promise<string | null> => {
      if (nmId === null) return null;
      const key = keyOf(clusterName);
      const before = positionsRef.current.get(key)?.capturedAt ?? null;
      setProbing((prev) => new Set(prev).add(key));
      try {
        await triggerClusterProbe(nmId, clusterName);
        // Поллим позиции, пока по этому кластеру не появится свежий снапшот.
        for (let i = 0; i < POLL_MAX_TRIES; i++) {
          await sleep(pollDelay(i));
          const items = await fetchPositions(nmId).catch(() => null);
          if (!items) continue;
          const snap = items.find((it) => keyOf(it.clusterName) === key);
          if (snap && snap.capturedAt !== before) {
            setPositions(buildMap(items));
            return snap.status;
          }
        }
      } catch {
        // оставляем прежнее значение ячейки
      } finally {
        setProbing((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
      return null;
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
        let gap = RUN_ALL_GAP_MS;
        for (let i = 0; i < orderedClusterNames.length; i++) {
          if (cancelRef.current) break;
          const status = await probeOneAsync(orderedClusterNames[i]!);
          setProgress({ done: i + 1, total: orderedClusterNames.length });
          // Самозащита: WB затроттлил → замедляемся (до потолка), иначе держим быстрый темп.
          gap =
            status === "throttled" || status === "blocked"
              ? Math.min(gap * 2, RUN_ALL_MAX_GAP_MS)
              : RUN_ALL_GAP_MS;
          if (i < orderedClusterNames.length - 1 && !cancelRef.current) {
            await sleep(gap);
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
