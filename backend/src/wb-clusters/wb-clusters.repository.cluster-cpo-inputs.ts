import {
  WbClustersRepositoryAutomation,
  type ClusterCpoInput,
} from "./wb-clusters.repository.automation";

/**
 * Звено репозитория: входы для CPO/CR кластеров за скользящие 30 дней (расход, заказы РК/JAM,
 * показы, состояние на WB). Вынесено из automation-звена по ответственности. Показы (views)
 * здесь — РЕАЛЬНЫЕ за 30 дней из wb_cluster_daily_stats, знаменатель CR для bid_cap (накопитель
 * accrual для этого не годится — он почти пустой). См. product-cluster-bid.ts.
 */
export abstract class WbClustersRepositoryClusterCpoInputs extends WbClustersRepositoryAutomation {
  async getClusterCpoInputs(advertId: number, nmId: number): Promise<ClusterCpoInput[]> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      normalized_cluster_name: string;
      cluster_name: string;
      spend: string | null;
      orders_rk: string | null;
      shks: string | null;
      orders_jam: string | null;
      views: string | null;
      source_kind: string | null;
      last_stat_date: string | null;
    }>(
      `
      WITH stats AS (
        SELECT normalized_cluster_name,
               MAX(cluster_name)        AS cluster_name,
               SUM(spend)               AS spend,
               SUM(orders)              AS orders_rk,
               SUM(shks)                AS shks,
               SUM(views)               AS views,
               MAX(stat_date)::text     AS last_stat_date
        FROM ${this.tableName("wb_cluster_daily_stats")}
        WHERE advert_id = $1 AND nm_id = $2
          AND stat_date >= (CURRENT_DATE - INTERVAL '30 days')
        GROUP BY normalized_cluster_name
      ),
      jam AS (
        SELECT LOWER(TRIM(cq.cluster_name)) AS ncn,
               SUM(r.orders_current)        AS orders_jam
        FROM ${this.tableName("wb_cabinet_cluster_queries")} cq
        JOIN ${this.tableName("wb_product_search_text_range_snapshots")} s
          ON s.nm_id = $2 AND s.start_date = s.end_date
         AND s.start_date >= (CURRENT_DATE - INTERVAL '30 days')
        JOIN ${this.tableName("wb_product_search_text_range_rows")} r
          ON r.snapshot_key = s.snapshot_key
         AND r.normalized_query_text = cq.normalized_query_text
        WHERE cq.advert_id = $1 AND cq.nm_id = $2
        GROUP BY LOWER(TRIM(cq.cluster_name))
      ),
      cur AS (
        SELECT c.normalized_cluster_name,
               MAX(c.cluster_name) AS cluster_name,
               -- overlay действия (desired_is_active) поверх синкнутого source_kind
               (CASE
                  WHEN BOOL_OR(a.action_key IS NOT NULL AND a.desired_is_active) THEN 'active'
                  WHEN BOOL_OR(a.action_key IS NOT NULL AND NOT a.desired_is_active) THEN 'excluded'
                  ELSE MAX(c.source_kind)
                END) AS source_kind
        FROM ${this.tableName("wb_clusters")} c
        LEFT JOIN ${this.tableName("wb_cluster_actions")} a
          ON a.advert_id = c.advert_id AND a.nm_id = c.nm_id
         AND a.normalized_cluster_name = c.normalized_cluster_name
        WHERE c.advert_id = $1 AND c.nm_id = $2
          AND (
            a.action_key IS NOT NULL
            OR c.source_kind IN ('active', 'excluded')
            OR c.is_active = FALSE
          )
        GROUP BY c.normalized_cluster_name
      )
      SELECT
        cur.normalized_cluster_name,
        COALESCE(cur.cluster_name, stats.cluster_name, cur.normalized_cluster_name) AS cluster_name,
        stats.spend,
        stats.orders_rk,
        stats.shks,
        jam.orders_jam,
        stats.views,
        cur.source_kind,
        stats.last_stat_date
      FROM cur
      LEFT JOIN stats ON stats.normalized_cluster_name = cur.normalized_cluster_name
      LEFT JOIN jam   ON jam.ncn = cur.normalized_cluster_name
      `,
      [advertId, nmId],
    );
    const num = (v: string | null): number => (v != null ? Number(v) : 0);
    return result.rows.map((r) => ({
      normalizedClusterName: r.normalized_cluster_name,
      clusterName: r.cluster_name,
      spend: num(r.spend),
      shks: r.shks != null ? Number(r.shks) : null,
      ordersRk: num(r.orders_rk),
      ordersJam: num(r.orders_jam),
      views: num(r.views),
      currentSourceKind: r.source_kind,
      lastStatDate: r.last_stat_date,
    }));
  }
}
