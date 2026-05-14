import type {
  StoredProductAdvertisingMutationContext,
} from "./wb-clusters.repository.types";
import type {
  ClusterSourceKind,
} from "./wb-clusters.types";
import { WbClustersRepositoryClusterLookupRead } from "./wb-clusters.repository.cluster-lookup-read";
export abstract class WbClustersRepositoryAdvertisingMutationRead extends WbClustersRepositoryClusterLookupRead {
  async getProductAdvertisingMutationContext(input: {
    nmId: number;
    advertId: number;
    normalizedClusterNames: string[];
  }): Promise<StoredProductAdvertisingMutationContext> {
    if (!this.isConfigured()) {
      return {
        campaign: null,
        clusters: [],
      };
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const normalizedClusterNames = Array.from(
      new Set(
        input.normalizedClusterNames
          .map((item) => this.normalizeQuery(item.trim()))
          .filter((item) => item.length > 0),
      ),
    );

    const campaignResult = await pool.query<{
      advert_id: string;
      payment_type: string | null;
      bid_type: string | null;
    }>(
      `
        SELECT
          c.advert_id::text AS advert_id,
          c.payment_type,
          c.bid_type
        FROM ${this.tableName("wb_campaign_products")} cp
        JOIN ${this.tableName("wb_campaigns")} c
          ON c.advert_id = cp.advert_id
        WHERE cp.nm_id = $1
          AND cp.advert_id = $2
        LIMIT 1
      `,
      [input.nmId, input.advertId],
    );

    const clusters =
      normalizedClusterNames.length === 0
        ? []
        : (
            await pool.query<{
              cluster_name: string;
              normalized_cluster_name: string;
              canonical_norm_query: string;
              source_kind: ClusterSourceKind;
              is_active: boolean | null;
            }>(
              `
                SELECT DISTINCT ON (c.normalized_cluster_name)
                  c.cluster_name,
                  c.normalized_cluster_name,
                  COALESCE(b.cluster_name, c.cluster_name) AS canonical_norm_query,
                  CASE
                    WHEN a.action_key IS NOT NULL THEN
                      CASE
                        WHEN a.desired_is_active THEN 'active'
                        ELSE 'excluded'
                      END::text
                    ELSE c.source_kind
                  END AS source_kind,
                  COALESCE(a.desired_is_active, c.is_active) AS is_active
                FROM ${this.tableName("wb_clusters")} c
                LEFT JOIN ${this.tableName("wb_cluster_bids")} b
                  ON b.advert_id = c.advert_id
                 AND b.nm_id = c.nm_id
                 AND b.normalized_cluster_name = c.normalized_cluster_name
                LEFT JOIN ${this.tableName("wb_cluster_actions")} a
                  ON a.advert_id = c.advert_id
                 AND a.nm_id = c.nm_id
                 AND a.normalized_cluster_name = c.normalized_cluster_name
                WHERE c.nm_id = $1
                  AND c.advert_id = $2
                  AND c.normalized_cluster_name = ANY($3::text[])
                ORDER BY
                  c.normalized_cluster_name,
                  CASE
                    WHEN a.action_key IS NOT NULL THEN 0
                    ELSE 1
                  END,
                  CASE
                    WHEN c.source_kind = 'active' THEN 0
                    WHEN c.source_kind = 'excluded' THEN 1
                    ELSE 2
                  END,
                  c.synced_at DESC
              `,
              [input.nmId, input.advertId, normalizedClusterNames],
            )
          ).rows.map((row) => ({
            clusterName: row.cluster_name,
            normalizedClusterName: row.normalized_cluster_name,
            canonicalNormQuery: row.canonical_norm_query,
            sourceKind: row.source_kind,
            isActive: row.is_active,
          }));

    const campaignRow = campaignResult.rows[0] ?? null;
    return {
      campaign: campaignRow
        ? {
            advertId: Number(campaignRow.advert_id),
            paymentType: campaignRow.payment_type,
            bidType: campaignRow.bid_type,
          }
        : null,
      clusters,
    };
  }

}
