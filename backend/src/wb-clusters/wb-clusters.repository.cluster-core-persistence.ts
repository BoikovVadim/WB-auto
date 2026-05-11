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
   * После синка помечает активные кластеры, которых WB больше не возвращает,
   * как source_kind='stats', is_active=NULL. Это убирает их из списка рабочего
   * пространства (WHERE source_kind IN ('active','excluded') их не поймает),
   * но сохраняет для исторических wb_cluster_daily_stats.
   *
   * Принимает raw имена кластеров; нормализует их внутри.
   * Для каждой кампании: деактивирует все 'active' кластеры, которых НЕТ в списке.
   */
  async deactivateStaleActiveClusters(
    items: Array<{
      advertId: number;
      nmId: number;
      activeClusterNames: string[];
    }>,
  ): Promise<void> {
    if (items.length === 0) return;
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    for (const item of items) {
      const normalizedNames = item.activeClusterNames.map((n) => this.normalizeQuery(n));
      await pool.query(
        `
          UPDATE ${this.tableName("wb_clusters")}
          SET source_kind = 'stats', is_active = NULL, synced_at = NOW()
          WHERE advert_id = $1
            AND nm_id = $2
            AND source_kind = 'active'
            AND normalized_cluster_name != ALL($3::text[])
        `,
        [item.advertId, item.nmId, normalizedNames],
      );
    }
  }

}
