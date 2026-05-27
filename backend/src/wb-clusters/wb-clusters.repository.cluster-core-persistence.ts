import type { PoolClient } from "pg";

import type {
  ClusterSourceKind,
} from "./wb-clusters.types";
import { WbClustersRepositoryCampaignEntityPersistence } from "./wb-clusters.repository.campaign-entity-persistence";

export abstract class WbClustersRepositoryClusterCorePersistence extends WbClustersRepositoryCampaignEntityPersistence {
  async upsertCluster(input: {
    advertId: number | null;
    nmId: number;
    clusterName: string;
    sourceKind: ClusterSourceKind;
    isActive: boolean | null;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const clusterKey = this.buildClusterKey(
      input.nmId,
      input.clusterName,
      input.sourceKind,
      input.advertId,
    );

    await pool.query(
      `
        INSERT INTO ${this.tableName("wb_clusters")} (
          cluster_key,
          advert_id,
          nm_id,
          cluster_name,
          normalized_cluster_name,
          source_kind,
          is_active,
          synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (cluster_key) DO UPDATE
        SET
          advert_id = EXCLUDED.advert_id,
          cluster_name = EXCLUDED.cluster_name,
          normalized_cluster_name = EXCLUDED.normalized_cluster_name,
          source_kind = EXCLUDED.source_kind,
          is_active = EXCLUDED.is_active,
          synced_at = NOW()
      `,
      [
        clusterKey,
        input.advertId,
        input.nmId,
        input.clusterName,
        this.normalizeQuery(input.clusterName),
        input.sourceKind,
        input.isActive,
      ],
    );

    return clusterKey;
  }

  async upsertClusters(
    inputs: Array<{
      advertId: number | null;
      nmId: number;
      clusterName: string;
      sourceKind: ClusterSourceKind;
      isActive: boolean | null;
    }>,
    client?: PoolClient,
  ) {
    if (inputs.length === 0) {
      return 0;
    }

    await this.ensureSchemaOrThrow();
    const executor = client ?? this.getPool();
    const deduplicatedInputs = Array.from(
      new Map(
        inputs.map((input) => [
          this.buildClusterKey(input.nmId, input.clusterName, input.sourceKind, input.advertId),
          input,
        ]),
      ).values(),
    );

    await executor.query(
      `
        INSERT INTO ${this.tableName("wb_clusters")} (
          cluster_key,
          advert_id,
          nm_id,
          cluster_name,
          normalized_cluster_name,
          source_kind,
          is_active,
          synced_at
        )
        SELECT
          cluster_key,
          advert_id,
          nm_id,
          cluster_name,
          normalized_cluster_name,
          source_kind,
          is_active,
          NOW()
        FROM UNNEST(
          $1::text[],
          $2::bigint[],
          $3::bigint[],
          $4::text[],
          $5::text[],
          $6::text[],
          $7::boolean[]
        ) AS rows(
          cluster_key,
          advert_id,
          nm_id,
          cluster_name,
          normalized_cluster_name,
          source_kind,
          is_active
        )
        ON CONFLICT (cluster_key) DO UPDATE
        SET
          advert_id = EXCLUDED.advert_id,
          cluster_name = EXCLUDED.cluster_name,
          normalized_cluster_name = EXCLUDED.normalized_cluster_name,
          source_kind = EXCLUDED.source_kind,
          is_active = EXCLUDED.is_active,
          synced_at = NOW()
      `,
      [
        deduplicatedInputs.map((input) =>
          this.buildClusterKey(input.nmId, input.clusterName, input.sourceKind, input.advertId),
        ),
        deduplicatedInputs.map((input) => input.advertId),
        deduplicatedInputs.map((input) => input.nmId),
        deduplicatedInputs.map((input) => input.clusterName),
        deduplicatedInputs.map((input) => this.normalizeQuery(input.clusterName)),
        deduplicatedInputs.map((input) => input.sourceKind),
        deduplicatedInputs.map((input) => input.isActive),
      ],
    );

    return deduplicatedInputs.length;
  }

  /**
   * Убирает дубли из wb_clusters: если для одного
   * (advert_id, nm_id, normalized_cluster_name) существуют одновременно
   * 'active' и 'excluded' записи (WB баг), 'excluded' запись удаляется.
   * С campaign-scoped cluster_key такая ситуация крайне маловероятна,
   * но функция оставлена как защитный барьер.
   */
  async deduplicateClustersBySourceKind(): Promise<number> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{ count: string }>(
      `
        WITH duplicates AS (
          SELECT c.cluster_key
          FROM ${this.tableName("wb_clusters")} c
          WHERE c.source_kind = 'excluded'
            AND EXISTS (
              SELECT 1 FROM ${this.tableName("wb_clusters")} c2
              WHERE c2.advert_id = c.advert_id
                AND c2.nm_id    = c.nm_id
                AND c2.normalized_cluster_name = c.normalized_cluster_name
                AND c2.source_kind = 'active'
            )
        ),
        stale AS (
          DELETE FROM ${this.tableName("wb_clusters")}
          WHERE cluster_key IN (SELECT cluster_key FROM duplicates)
          RETURNING 1
        )
        SELECT COUNT(*)::text AS count FROM stale
      `,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * После синка удаляет кластеры кампании, которых WB больше не возвращает.
   *
   * С момента перехода на campaign-scoped cluster_key (включает advertId),
   * safe to DELETE: исторические данные хранятся в wb_cluster_daily_stats
   * (собственный PK, не ссылается на wb_clusters.cluster_key) и в product-scoped
   * wb_cluster_stats (ключ {nmId}:stats:{name}, не затрагивается).
   *
   * Два прохода, чтобы устранить конфликты при переходе кластера между списками:
   *   1. Старые 'active' записи, которых нет в текущем active-списке WB → DELETE.
   *   2. Старые 'excluded' записи, которых нет в текущем excluded-списке WB → DELETE.
   */
  async deactivateStaleActiveClusters(
    items: Array<{
      advertId: number;
      nmId: number;
      activeClusterNames: string[];
      excludedClusterNames?: string[];
    }>,
  ): Promise<void> {
    if (items.length === 0) return;
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    for (const item of items) {
      const normalizedActive = item.activeClusterNames.map((n) => this.normalizeQuery(n));
      const normalizedExcluded = (item.excludedClusterNames ?? []).map((n) => this.normalizeQuery(n));
      // An empty name array would make `!= ALL('{}')` true for every row and
      // delete ALL active/excluded clusters for this (advertId, nmId). A transient
      // or partial WB response (missing normQueries field) is indistinguishable
      // from a legitimate "list is now empty" here, so we treat empty as "no
      // authoritative list" and skip the DELETE rather than risk wiping clusters.
      // Pass 1: remove stale 'active' entries (not in current WB active list).
      if (normalizedActive.length > 0) {
        await pool.query(
          `
            DELETE FROM ${this.tableName("wb_clusters")}
            WHERE advert_id = $1
              AND nm_id = $2
              AND source_kind = 'active'
              AND normalized_cluster_name != ALL($3::text[])
          `,
          [item.advertId, item.nmId, normalizedActive],
        );
      }
      // Pass 2: remove stale 'excluded' entries (not in current WB excluded list).
      if (normalizedExcluded.length > 0) {
        await pool.query(
          `
            DELETE FROM ${this.tableName("wb_clusters")}
            WHERE advert_id = $1
              AND nm_id = $2
              AND source_kind = 'excluded'
              AND normalized_cluster_name != ALL($3::text[])
          `,
          [item.advertId, item.nmId, normalizedExcluded],
        );
      }
    }
  }

}
