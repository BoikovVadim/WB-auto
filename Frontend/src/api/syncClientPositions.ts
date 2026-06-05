import { apiClient } from "./syncClientHttp";

/**
 * Место товара в поисковой выдаче WB по кластеру на момент замера (v1, ручной парсер).
 * Бэкенд зондирует search.wb.ru по топ-частотному запросу кластера; фронт только
 * запускает обход и отображает результат + статус (в т.ч. throttled — лимит на 1 IP).
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
  organicPosition: number | null;
  adPosition: number | null;
  isAd: boolean;
  page: number | null;
  scannedCount: number | null;
  capturedAt: string;
};

export type PositionRunStatus = {
  nmId: number;
  status: "idle" | "running" | "done";
  total: number;
  processed: number;
  found: number;
  notFound: number;
  throttled: number;
  blocked: number;
  startedAt: string | null;
  finishedAt: string | null;
  stoppedEarly: boolean;
  items: ClusterPositionLatest[];
};

const emptyStatus = (nmId: number): PositionRunStatus => ({
  nmId,
  status: "idle",
  total: 0,
  processed: 0,
  found: 0,
  notFound: 0,
  throttled: 0,
  blocked: 0,
  startedAt: null,
  finishedAt: null,
  stoppedEarly: false,
  items: [],
});

/** Запустить обход позиций по товару (фоновый; статус читать через fetchPositionStatus). */
export async function startPositionRun(
  nmId: number,
  limit?: number,
): Promise<PositionRunStatus> {
  const response = await apiClient.post<PositionRunStatus>(
    `/wb-clusters/products/${nmId}/positions/run`,
    undefined,
    limit !== undefined ? { params: { limit } } : undefined,
  );
  return response.data ?? emptyStatus(nmId);
}

/** Статус обхода + последние замеры мест по кластерам товара. */
export async function fetchPositionStatus(
  nmId: number,
): Promise<PositionRunStatus> {
  const response = await apiClient.get<PositionRunStatus>(
    `/wb-clusters/products/${nmId}/positions`,
  );
  return response.data ?? emptyStatus(nmId);
}
