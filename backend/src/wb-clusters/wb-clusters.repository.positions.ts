import { WbClustersRepositoryAutomation } from "./wb-clusters.repository.automation";

export interface RepresentativeClusterQuery {
  normalizedClusterName: string;
  clusterName: string;
  topQuery: string;
  monthlyFrequency: number;
}

export interface ClusterPositionSnapshotInput {
  nmId: number;
  normalizedClusterName: string;
  clusterName: string;
  probeQuery: string;
  probeFrequency: number | null;
  dest: string;
  status: string;
  organicPosition: number | null;
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
  adPosition: number | null;
  isAd: boolean;
  page: number | null;
  scannedCount: number | null;
  capturedAt: string;
}

/**
 * Звено цепочки репозитория для фичи «место товара в выдаче по кластеру».
 * Чтение репрезентативных (самых частотных) запросов кластеров товара + запись/чтение
 * истории замеров позиций (wb_cluster_position_snapshots).
 */
export abstract class WbClustersRepositoryPositions extends WbClustersRepositoryAutomation {
  /**
   * Топ-N кластеров товара по частотности с ОДНИМ репрезентативным запросом каждого
   * (самый высокочастотный запрос кластера). Это и есть подмножество для зонда позиций.
   */
  async getRepresentativeClusterQueries(
    nmId: number,
    limit: number,
  ): Promise<RepresentativeClusterQuery[]> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      normalized_cluster_name: string;
      cluster_name: string;
      top_query: string;
      freq: string;
    }>(
      `
      SELECT
        normalized_cluster_name,
        (array_agg(cluster_name ORDER BY monthly_frequency DESC NULLS LAST))[1] AS cluster_name,
        (array_agg(query_text ORDER BY monthly_frequency DESC NULLS LAST))[1]   AS top_query,
        MAX(monthly_frequency)                                                  AS freq
      FROM ${this.tableName("wb_cabinet_cluster_queries")}
      WHERE nm_id = $1 AND monthly_frequency > 0
      GROUP BY normalized_cluster_name
      ORDER BY freq DESC
      LIMIT $2
      `,
      [nmId, limit],
    );
    return result.rows.map((r) => ({
      normalizedClusterName: r.normalized_cluster_name,
      clusterName: r.cluster_name,
      topQuery: r.top_query,
      monthlyFrequency: Number(r.freq),
    }));
  }

  /**
   * Топ-частотный запрос ОДНОГО кластера товара (для on-demand замера по строке).
   * Матчим по нормализованному имени кластера (LOWER(TRIM(cluster_name))) — фронт
   * присылает отображаемое имя кластера из той же WB-выдачи.
   */
  async getRepresentativeClusterQueryForCluster(
    nmId: number,
    clusterName: string,
  ): Promise<RepresentativeClusterQuery | null> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      normalized_cluster_name: string;
      cluster_name: string;
      top_query: string;
      freq: string;
    }>(
      `
      SELECT
        (array_agg(normalized_cluster_name ORDER BY monthly_frequency DESC NULLS LAST))[1] AS normalized_cluster_name,
        (array_agg(cluster_name ORDER BY monthly_frequency DESC NULLS LAST))[1]            AS cluster_name,
        (array_agg(query_text ORDER BY monthly_frequency DESC NULLS LAST))[1]              AS top_query,
        MAX(monthly_frequency)                                                             AS freq
      FROM ${this.tableName("wb_cabinet_cluster_queries")}
      WHERE nm_id = $1
        AND LOWER(TRIM(cluster_name)) = LOWER(TRIM($2))
        AND monthly_frequency > 0
      `,
      [nmId, clusterName],
    );
    const row = result.rows[0];
    if (!row || !row.top_query) return null;
    return {
      normalizedClusterName: row.normalized_cluster_name,
      clusterName: row.cluster_name,
      topQuery: row.top_query,
      monthlyFrequency: Number(row.freq),
    };
  }

  async insertClusterPositionSnapshot(
    input: ClusterPositionSnapshotInput,
  ): Promise<void> {
    await this.ensureSchemaOrThrow();
    await this.getPool().query(
      `
      INSERT INTO ${this.tableName("wb_cluster_position_snapshots")}
        (nm_id, normalized_cluster_name, cluster_name, probe_query, probe_frequency,
         dest, status, organic_position, ad_position, is_ad, page, scanned_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
      ad_position: number | null;
      is_ad: boolean;
      page: number | null;
      scanned_count: number | null;
      captured_at: string;
    }>(
      `
      SELECT DISTINCT ON (normalized_cluster_name)
        normalized_cluster_name, cluster_name, probe_query, status,
        organic_position, ad_position, is_ad, page, scanned_count,
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
      adPosition: r.ad_position,
      isAd: r.is_ad,
      page: r.page,
      scannedCount: r.scanned_count,
      capturedAt: r.captured_at,
    }));
  }
}
