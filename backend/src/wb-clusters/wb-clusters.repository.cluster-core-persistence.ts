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
          this.buildClusterKey(input.nmId, input.clusterName, input.sourceKind),
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
          this.buildClusterKey(input.nmId, input.clusterName, input.sourceKind),
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
   * Убирает дубли из wb_clusters одноразовой чисткой: если для одного
   * (advert_id, nm_id, normalized_cluster_name) существуют одновременно
   * 'active' и 'excluded' записи, 'excluded' переводится в 'stats'.
   * Вызывается один раз в начале структурной фазы.
   */
  async deduplicateClustersBySourceKind(): Promise<number> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{ count: string }>(
      `
        WITH stale AS (
          UPDATE ${this.tableName("wb_clusters")} AS c
          SET source_kind = 'stats', is_active = NULL, synced_at = NOW()
          WHERE c.source_kind = 'excluded'
            AND EXISTS (
              SELECT 1 FROM ${this.tableName("wb_clusters")} c2
              WHERE c2.advert_id = c.advert_id
                AND c2.nm_id    = c.nm_id
                AND c2.normalized_cluster_name = c.normalized_cluster_name
                AND c2.source_kind = 'active'
            )
          RETURNING 1
        )
        SELECT COUNT(*)::text AS count FROM stale
      `,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * После синка помечает кластеры, которых WB больше не возвращает в своём
   * источнике, как source_kind='stats', is_active=NULL. Убирает их из рабочего
   * пространства, сохраняя для исторических wb_cluster_daily_stats.
   *
   * Два прохода, чтобы устранить дубликаты при переходе кластера между списками:
   *   1. Старые 'active' записи, которых нет в текущем active-списке WB → 'stats'.
   *      Обрабатывает переход active→excluded и выбывшие кластеры.
   *   2. Старые 'excluded' записи, которых нет в текущем excluded-списке WB → 'stats'.
   *      Обрабатывает переход excluded→active: иначе в wb_clusters существуют ОБЕ
   *      записи для одного normalized_cluster_name, JOIN возвращает дубликаты.
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
      // Pass 1: deactivate stale 'active' entries (not in current WB active list).
      await pool.query(
        `
          UPDATE ${this.tableName("wb_clusters")}
          SET source_kind = 'stats', is_active = NULL, synced_at = NOW()
          WHERE advert_id = $1
            AND nm_id = $2
            AND source_kind = 'active'
            AND normalized_cluster_name != ALL($3::text[])
        `,
        [item.advertId, item.nmId, normalizedActive],
      );
      // Pass 2: deactivate stale 'excluded' entries (not in current WB excluded list).
      // Prevents duplicates when a cluster moves from excluded back to active.
      await pool.query(
        `
          UPDATE ${this.tableName("wb_clusters")}
          SET source_kind = 'stats', is_active = NULL, synced_at = NOW()
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
