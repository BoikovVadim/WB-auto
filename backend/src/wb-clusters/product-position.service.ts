import { Injectable, Logger } from "@nestjs/common";

import type { ClusterPositionLatest } from "./wb-clusters.repository.positions";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbSearchPositionProbeClient } from "./wb-search-position-probe.client";

const DEST_MOSCOW = "-1257786";

/**
 * Фича «место товара в выдаче WB по кластеру на момент замера» (v1, ручной запуск, 1 IP).
 *
 * Замер делается ПО ОДНОМУ кластеру (по строке таблицы или последовательно при глобальном
 * пуске — порядок задаёт фронт). Зонд грузит страницу выдачи в реальном браузере через
 * мобильный прокси (browser-render проходит анти-бот). Первый замер «холодный» (~75с на
 * прогрев сессии), поэтому замер запускается ФОНОМ (startClusterProbe), а фронт поллит
 * getLatestPositions, пока не появится свежий снапшот. Результат держится в истории
 * (wb_cluster_position_snapshots) до следующего ручного замера / перезахода.
 */
@Injectable()
export class ProductPositionService {
  private readonly logger = new Logger(ProductPositionService.name);
  /** Кластеры с замером «в полёте» — дедуп повторных кликов/пусков. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly repository: WbClustersRepository,
    private readonly probe: WbSearchPositionProbeClient,
  ) {}

  /** Все последние замеры по кластерам товара (для отрисовки колонки). */
  getLatestPositions(nmId: number): Promise<ClusterPositionLatest[]> {
    return this.repository.getLatestClusterPositions(nmId);
  }

  /**
   * Запустить замер кластера ФОНОМ (не держим HTTP — холодный замер ~75с). Дедупим
   * повторные запросы по (nmId, кластер). Результат фронт заберёт поллингом позиций.
   */
  startClusterProbe(nmId: number, clusterName: string): { queued: boolean } {
    const key = `${nmId}:${clusterName.trim().toLowerCase()}`;
    if (this.inFlight.has(key)) return { queued: false };
    this.inFlight.add(key);
    void this.probeCluster(nmId, clusterName)
      .catch((error: Error) =>
        this.logger.warn(`probe «${clusterName}» nm ${nmId}: ${error.message}`),
      )
      .finally(() => this.inFlight.delete(key));
    return { queued: true };
  }

  /**
   * Замерить место товара по одному кластеру и вернуть свежий снапшот.
   * Ищем по САМОМУ ИМЕНИ кластера (канонический запрос) — «самый частотный запрос
   * кластера» из кабинета засорён мусором с высокой глобальной частотой (в кластер
   * «клетка для кролика» попадают «рваные джинсы женские» и т.п.), он даёт неверную выдачу.
   */
  async probeCluster(
    nmId: number,
    clusterName: string,
    depth?: number,
  ): Promise<ClusterPositionLatest> {
    const probeQuery = clusterName.trim();
    const normalizedClusterName = probeQuery.toLowerCase();

    const result = await this.probe.probeQueryPosition(
      probeQuery,
      nmId,
      depth != null ? { depth } : {},
    );

    const snapshot: ClusterPositionLatest = {
      normalizedClusterName,
      clusterName: probeQuery,
      probeQuery,
      status: result.status,
      organicPosition: result.organicPosition,
      displayPosition: result.displayPosition,
      adPosition: result.adPosition,
      isAd: result.isAd,
      page: result.page,
      scannedCount: result.scanned,
      capturedAt: new Date().toISOString(),
    };

    await this.repository.insertClusterPositionSnapshot({
      nmId,
      normalizedClusterName,
      clusterName: probeQuery,
      probeQuery,
      probeFrequency: null,
      dest: DEST_MOSCOW,
      status: result.status,
      organicPosition: result.organicPosition,
      displayPosition: result.displayPosition,
      adPosition: result.adPosition,
      isAd: result.isAd,
      page: result.page,
      scannedCount: result.scanned,
    });

    return snapshot;
  }
}
