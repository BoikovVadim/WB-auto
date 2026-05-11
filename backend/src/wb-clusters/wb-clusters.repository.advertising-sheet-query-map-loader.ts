import type { Pool } from "pg";

import type { ClusterSourceKind } from "./wb-clusters.types";
import { WbClustersRepositoryAdvertisingSheetCoreQueryLoader } from "./wb-clusters.repository.advertising-sheet-core-query-loader";

export abstract class WbClustersRepositoryAdvertisingSheetQueryMapLoader extends WbClustersRepositoryAdvertisingSheetCoreQueryLoader {
  protected async loadProductAdvertisingSheetQueryRows(pool: Pool, nmId: number) {
    const [clusterQueriesResult, cabinetClusterQueriesResult] = await Promise.all([
      pool.query<{
          advert_id: string;
          cluster_name: string;
          normalized_cluster_name: string;
          query_text: string;
          normalized_query_text: string;
          source_kind: ClusterSourceKind;
          is_active: boolean | null;
          views: string | null;
          clicks: string | null;
          orders: string | null;
          add_to_cart: string | null;
          shks: string | null;
          monthly_frequency: string | null;
          updated_at: string | null;
          }>(
          `
          SELECT DISTINCT ON (cq.advert_id, cq.cluster_name, cq.query_text)
          cq.advert_id::text AS advert_id,
          cq.cluster_name,
          cq.normalized_cluster_name,
          cq.query_text,
          cq.normalized_query_text,
          COALESCE(assigned_cluster.source_kind, 'query-map')::text AS source_kind,
          COALESCE(assigned_cluster.is_active, TRUE) AS is_active,
          s.views::text AS views,
          s.clicks::text AS clicks,
          s.orders::text AS orders,
          s.add_to_cart::text AS add_to_cart,
          s.shks::text AS shks,
          f.monthly_frequency::text AS monthly_frequency,
          GREATEST(
          cq.synced_at,
          COALESCE(s.synced_at, cq.synced_at),
          COALESCE(c.synced_at, cq.synced_at),
          COALESCE(f.synced_at, cq.synced_at)
          )::text AS updated_at
          FROM ${this.tableName("wb_cluster_queries")} cq
          LEFT JOIN ${this.tableName("wb_clusters")} assigned_cluster
          ON assigned_cluster.nm_id = cq.nm_id
          AND assigned_cluster.advert_id = cq.advert_id
          AND assigned_cluster.normalized_cluster_name = cq.normalized_cluster_name
          LEFT JOIN ${this.tableName("wb_clusters")} c
          ON c.nm_id = cq.nm_id
          AND c.advert_id = cq.advert_id
          AND c.normalized_cluster_name = cq.normalized_query_text
          LEFT JOIN ${this.tableName("wb_cluster_stats")} s
          ON s.cluster_key = c.cluster_key
          LEFT JOIN ${this.tableName("wb_search_query_frequencies")} f
          ON f.normalized_query_text = cq.normalized_query_text
          WHERE cq.nm_id = $1
          AND (
            cq.normalized_cluster_name = cq.normalized_query_text
            OR NOT EXISTS (
              SELECT 1 FROM ${this.tableName("wb_clusters")} other_cluster
              WHERE other_cluster.nm_id = cq.nm_id
              AND other_cluster.normalized_cluster_name = cq.normalized_query_text
            )
          )
          ORDER BY
          cq.advert_id,
          cq.cluster_name,
          cq.query_text,
          CASE COALESCE(c.source_kind, 'query-map')
          WHEN 'stats' THEN 0
          WHEN 'active' THEN 1
          WHEN 'excluded' THEN 2
          ELSE 3
          END,
          COALESCE(s.synced_at, c.synced_at, cq.synced_at) DESC
          `,
          [nmId],
          )
      ,
      pool.query<{
          advert_id: string;
          cluster_name: string;
          normalized_cluster_name: string;
          query_text: string;
          normalized_query_text: string;
          source_kind: ClusterSourceKind;
          is_active: boolean | null;
          views: string | null;
          clicks: string | null;
          orders: string | null;
          add_to_cart: string | null;
          shks: string | null;
          monthly_frequency: string | null;
          captured_at: string;
          updated_at: string | null;
          }>(
          `
          SELECT DISTINCT ON (cq.advert_id, cq.cluster_name, cq.query_text)
          cq.advert_id::text AS advert_id,
          cq.cluster_name,
          cq.normalized_cluster_name,
          cq.query_text,
          cq.normalized_query_text,
          COALESCE(assigned_cluster.source_kind, 'query-map')::text AS source_kind,
          COALESCE(assigned_cluster.is_active, TRUE) AS is_active,
          stats.views::text AS views,
          stats.clicks::text AS clicks,
          stats.orders::text AS orders,
          stats.add_to_cart::text AS add_to_cart,
          stats.shks::text AS shks,
          f.monthly_frequency::text AS monthly_frequency,
          cq.captured_at::text AS captured_at,
          GREATEST(
          cq.synced_at,
          COALESCE(stats.synced_at, cq.synced_at),
          COALESCE(assigned_cluster.synced_at, cq.synced_at),
          COALESCE(f.synced_at, cq.synced_at)
          )::text AS updated_at
          FROM ${this.tableName("wb_cabinet_cluster_queries")} cq
          LEFT JOIN ${this.tableName("wb_clusters")} assigned_cluster
          ON assigned_cluster.nm_id = cq.nm_id
          AND assigned_cluster.advert_id = cq.advert_id
          AND assigned_cluster.normalized_cluster_name = cq.normalized_cluster_name
          LEFT JOIN ${this.tableName("wb_clusters")} exact_cluster
          ON exact_cluster.nm_id = cq.nm_id
          AND exact_cluster.advert_id = cq.advert_id
          AND exact_cluster.normalized_cluster_name = cq.normalized_query_text
          LEFT JOIN ${this.tableName("wb_cluster_stats")} stats
          ON stats.cluster_key = exact_cluster.cluster_key
          LEFT JOIN ${this.tableName("wb_search_query_frequencies")} f
          ON f.normalized_query_text = cq.normalized_query_text
          WHERE cq.nm_id = $1
          ORDER BY
          cq.advert_id,
          cq.cluster_name,
          cq.query_text,
          cq.captured_at DESC,
          cq.synced_at DESC
          `,
          [nmId],
          )
      ,
    ]);
    return {
      clusterQueriesResult,
      cabinetClusterQueriesResult,
    };
  }

}
