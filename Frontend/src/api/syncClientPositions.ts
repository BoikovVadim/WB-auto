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
  organicPosition: number | null;
  adPosition: number | null;
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

/** Замерить место товара по одному кластеру (возвращает свежий снапшот). */
export async function probeClusterPosition(
  nmId: number,
  clusterName: string,
): Promise<ClusterPositionLatest> {
  const response = await apiClient.post<ClusterPositionLatest>(
    `/wb-clusters/products/${nmId}/positions/run-cluster`,
    undefined,
    { params: { clusterName } },
  );
  return response.data;
}
