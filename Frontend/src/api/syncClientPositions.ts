import { apiClient } from "./syncClientHttp";

/**
 * Место товара в поисковой выдаче WB по кластеру на момент замера (v1, ручной замер).
 * Бэкенд зондирует search.wb.ru по топ-частотному запросу кластера; фронт запускает замер
 * (по строке или последовательно глобальной кнопкой) и рисует результат + статус.
 */
export type ClusterPositionStatus =
  | "found"
  | "not_found"
  | "throttled"
  | "blocked"
  | "error";

export type ClusterPositionLatest = {
  normalizedClusterName: string;
  clusterName: string;
  probeQuery: string;
  status: ClusterPositionStatus;
  /** Метрика 1 — ЧИСТАЯ органика без рекламы (внешний search.wb.ru). */
  organicPosition: number | null;
  /** Метрика 2 — позиция в выдаче с рекламным бустом (что видит покупатель, u-search). */
  displayPosition: number | null;
  /** Метрика 3 — рекламный слот; недоступен (WB не отдаёт метку анониму) → всегда null. */
  adPosition: number | null;
  /** Реклама заметно бустит товар (display выше органики на ≥5 позиций). */
  isAd: boolean;
  page: number | null;
  scannedCount: number | null;
  capturedAt: string;
};

export type PositionsResponse = {
  nmId: number;
  items: ClusterPositionLatest[];
};

/** Последние замеры мест по всем кластерам товара. */
export async function fetchPositions(nmId: number): Promise<ClusterPositionLatest[]> {
  const response = await apiClient.get<PositionsResponse>(
    `/wb-clusters/products/${nmId}/positions`,
  );
  return response.data?.items ?? [];
}

/**
 * Запустить замер места по одному кластеру (фоновый, ~75с холодный старт). Результат
 * забирается поллингом fetchPositions — здесь только триггерим.
 */
export async function triggerClusterProbe(
  nmId: number,
  clusterName: string,
): Promise<{ queued: boolean }> {
  const response = await apiClient.post<{ queued: boolean }>(
    `/wb-clusters/products/${nmId}/positions/run-cluster`,
    undefined,
    { params: { clusterName } },
  );
  return response.data ?? { queued: false };
}
