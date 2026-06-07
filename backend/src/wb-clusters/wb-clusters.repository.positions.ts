import { WbClustersRepositoryAccrual } from "./wb-clusters.repository.accrual";

export interface ClusterPositionSnapshotInput {
  nmId: number;
  normalizedClusterName: string;
  clusterName: string;
  probeQuery: string;
  probeFrequency: number | null;
  dest: string;
  status: string;
  /** Метрика 1 — органика без рекламы. */
  organicPosition: number | null;
  /** Метрика 2 — органика с рекламой (что видит покупатель). */
  displayPosition: number | null;
  /** Метрика 3 — рекламный слот. */
  adPosition: number | null;
  isAd: boolean;
  page: number | null;
  scannedCount: number | null;
}

export interface ClusterPositionLatest {
  normalizedClusterName: string;
  clusterName: string;
  probeQuery: string;
  status: string;
  organicPosition: number | null;
  displayPosition: number | null;
  adPosition: number | null;
  isAd: boolean;
  page: number | null;
  scannedCount: number | null;
  capturedAt: string;
}

/**
 * Звено цепочки репозитория для фичи «место товара в выдаче по кластеру»:
 * запись/чтение истории замеров позиций (wb_cluster_position_snapshots).
 */
export abstract class WbClustersRepositoryPositions extends WbClustersRepositoryAccrual {
  async insertClusterPositionSnapshot(
    input: ClusterPositionSnapshotInput,
  ): Promise<void> {
    await this.ensureSchemaOrThrow();
    await this.getPool().query(
      `
      INSERT INTO ${this.tableName("wb_cluster_position_snapshots")}
        (nm_id, normalized_cluster_name, cluster_name, probe_query, probe_frequency,
         dest, status, organic_position, display_position, ad_position, is_ad, page, scanned_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        input.nmId,
        input.normalizedClusterName,
        input.clusterName,
        input.probeQuery,
        input.probeFrequency,
        input.dest,
        input.status,
        input.organicPosition,
        input.displayPosition,
        input.adPosition,
        input.isAd,
        input.page,
        input.scannedCount,
      ],
    );
  }

  /** Последний замер на каждый кластер товара (для отображения «Позиция сейчас»). */
  async getLatestClusterPositions(nmId: number): Promise<ClusterPositionLatest[]> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      normalized_cluster_name: string;
      cluster_name: string;
      probe_query: string;
      status: string;
      organic_position: number | null;
      display_position: number | null;
      ad_position: number | null;
      is_ad: boolean;
      page: number | null;
      scanned_count: number | null;
      captured_at: string;
    }>(
      `
      SELECT DISTINCT ON (normalized_cluster_name)
        normalized_cluster_name, cluster_name, probe_query, status,
        organic_position, display_position, ad_position, is_ad, page, scanned_count,
        captured_at::text AS captured_at
      FROM ${this.tableName("wb_cluster_position_snapshots")}
      WHERE nm_id = $1
      ORDER BY normalized_cluster_name, captured_at DESC
      `,
      [nmId],
    );
    return result.rows.map((r) => ({
      normalizedClusterName: r.normalized_cluster_name,
      clusterName: r.cluster_name,
      probeQuery: r.probe_query,
      status: r.status,
      organicPosition: r.organic_position,
      displayPosition: r.display_position,
      adPosition: r.ad_position,
      isAd: r.is_ad,
      page: r.page,
      scannedCount: r.scanned_count,
      capturedAt: r.captured_at,
    }));
  }
}
