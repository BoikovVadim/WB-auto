import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchClusterAutomationStatus,
  reviewClusterAutomation,
  setClusterAutomationMode,
  type AutomationMode,
  type ClusterAutomationStatus,
  type ClusterReviewAction,
} from "../../../api/syncClientClusterAutomation";

// Движок крутится кроном каждые 10 мин; статус освежаем с тем же интервалом.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

const EMPTY: ClusterAutomationStatus = { mode: "off", maxCpo: null, pendingCount: 0, clusters: [] };

export type ReviewClusterInput = {
  normalizedClusterName: string;
  clusterName: string;
  action: ClusterReviewAction;
};

export type UseClusterAutomationResult = {
  status: ClusterAutomationStatus;
  isBusy: boolean;
  setMode: (mode: AutomationMode) => Promise<void>;
  reviewCluster: (input: ReviewClusterInput) => Promise<void>;
};

/**
 * Статус и управление автоматизацией кластеров по CPO для (nmId, advertId).
 * setMode — оптимистично меняет режим, шлёт на бэк, синхронизируется ответом.
 */
export function useClusterAutomation(
  nmId: number | null,
  advertId: number | null,
): UseClusterAutomationResult {
  const [status, setStatus] = useState<ClusterAutomationStatus>(EMPTY);
  const [isBusy, setIsBusy] = useState(false);
  const isMountedRef = useRef(true);
  // Монотонный счётчик запросов: применяем ответ ТОЛЬКО если он от последнего
  // выпущенного запроса. Без него медленный начальный GET (тяжёлый getProductCpo),
  // выпущенный пока в БД ещё mode=off, дорезолвливался ПОСЛЕ свежего setMode и
  // перетирал его результат на off — флажок сбрасывался, числа обнулялись, и
  // приходилось кликать второй раз. Последнее действие пользователя авторитетно.
  const requestGenRef = useRef(0);

  const load = useCallback(() => {
    if (nmId === null || advertId === null) {
      requestGenRef.current += 1; // инвалидируем любые ответы в полёте
      setStatus(EMPTY);
      return;
    }
    const gen = ++requestGenRef.current;
    fetchClusterAutomationStatus(nmId, advertId)
      .then((s) => {
        if (isMountedRef.current && gen === requestGenRef.current) setStatus(s);
      })
      .catch(() => {
        /* keep previous */
      });
  }, [nmId, advertId]);

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

  const setMode = useCallback(
    async (mode: AutomationMode) => {
      if (nmId === null || advertId === null) return;
      const prev = status;
      const gen = ++requestGenRef.current; // write — самый свежий запрос; гасит in-flight GET
      setStatus((s) => ({ ...s, mode })); // optimistic
      setIsBusy(true);
      try {
        const next = await setClusterAutomationMode(nmId, advertId, mode);
        if (isMountedRef.current && gen === requestGenRef.current) setStatus(next);
      } catch {
        if (isMountedRef.current && gen === requestGenRef.current) setStatus(prev); // rollback
      } finally {
        if (isMountedRef.current) setIsBusy(false);
      }
    },
    [nmId, advertId, status],
  );

  const reviewCluster = useCallback(
    async (input: ReviewClusterInput) => {
      if (nmId === null || advertId === null) return;
      const prev = status;
      const gen = ++requestGenRef.current;
      // Оптимистично убираем кластер из «на проверке»: чтобы UI откликнулся сразу,
      // ставим его в approved (списки/счётчик pending пересчитаются по ответу бэка).
      setStatus((s) => ({
        ...s,
        pendingCount: Math.max(0, s.pendingCount - 1),
        clusters: s.clusters.map((c) =>
          c.normalizedClusterName === input.normalizedClusterName
            ? { ...c, reviewStatus: "approved" as const }
            : c,
        ),
      }));
      setIsBusy(true);
      try {
        const next = await reviewClusterAutomation(nmId, advertId, input);
        if (isMountedRef.current && gen === requestGenRef.current) setStatus(next);
      } catch (e) {
        if (isMountedRef.current && gen === requestGenRef.current) setStatus(prev); // rollback
        throw e; // пробрасываем: вызывающий (модалка) должен знать о провале и не стирать черновик
      } finally {
        if (isMountedRef.current) setIsBusy(false);
      }
    },
    [nmId, advertId, status],
  );

  return { status, isBusy, setMode, reviewCluster };
}
