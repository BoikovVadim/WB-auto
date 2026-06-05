import { Injectable } from "@nestjs/common";

import type { ClusterPositionLatest } from "./wb-clusters.repository.positions";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbSearchPositionProbeClient } from "./wb-search-position-probe.client";

const DEST_MOSCOW = "-1257786";

/**
 * Фича «место товара в выдаче WB по кластеру на момент замера» (v1, ручной запуск, 1 IP).
 *
 * Замер делается ПО ОДНОМУ кластеру (по строке таблицы или последовательно при глобальном
 * пуске — порядок задаёт фронт по текущей сортировке/экрану). Зонд ходит к search.wb.ru
 * с IP прод-сервера. Результат пишется в историю (wb_cluster_position_snapshots) и держится
 * до следующего ручного замера / перезахода в товар.
 */
@Injectable()
export class ProductPositionService {
  constructor(
    private readonly repository: WbClustersRepository,
    private readonly probe: WbSearchPositionProbeClient,
  ) {}

  /** Все последние замеры по кластерам товара (для отрисовки колонки). */
  getLatestPositions(nmId: number): Promise<ClusterPositionLatest[]> {
    return this.repository.getLatestClusterPositions(nmId);
  }

  /**
   * Замерить место товара по одному кластеру и вернуть свежий снапшот.
   * Репрезентативный запрос = самый частотный запрос кластера; если такого нет
   * (нет частотности) — пробуем по самому имени кластера как запросу.
   */
  async probeCluster(
    nmId: number,
    clusterName: string,
  ): Promise<ClusterPositionLatest> {
    const representative =
      await this.repository.getRepresentativeClusterQueryForCluster(nmId, clusterName);
    const probeQuery = representative?.topQuery ?? clusterName;
    const normalizedClusterName =
      representative?.normalizedClusterName ?? clusterName.trim().toLowerCase();
    const resolvedClusterName = representative?.clusterName ?? clusterName;

    const result = await this.probe.probeQueryPosition(probeQuery, nmId);

    const snapshot: ClusterPositionLatest = {
      normalizedClusterName,
      clusterName: resolvedClusterName,
      probeQuery,
      status: result.status,
      organicPosition: result.organicPosition,
      adPosition: result.adPosition,
      isAd: result.isAd,
      page: result.page,
      scannedCount: result.scanned,
      capturedAt: new Date().toISOString(),
    };

    await this.repository.insertClusterPositionSnapshot({
      nmId,
      normalizedClusterName,
      clusterName: resolvedClusterName,
      probeQuery,
      probeFrequency: representative?.monthlyFrequency ?? null,
      dest: DEST_MOSCOW,
      status: result.status,
      organicPosition: result.organicPosition,
      adPosition: result.adPosition,
      isAd: result.isAd,
      page: result.page,
      scannedCount: result.scanned,
    });

    return snapshot;
  }
}
