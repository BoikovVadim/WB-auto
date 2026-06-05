import type { Pool, QueryResult, QueryResultRow } from "pg";

import { appEnv } from "../common/env";
import type { ClusterSourceKind } from "./wb-clusters.types";
import { WbClustersRepositoryAdvertisingSheetCoreQueryLoader } from "./wb-clusters.repository.advertising-sheet-core-query-loader";

type SheetClusterQueryRow = {
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
};

type SheetCabinetClusterQueryRow = SheetClusterQueryRow & { captured_at: string };

function emptyQueryResult<T extends QueryResultRow>(): QueryResult<T> {
  return { command: "SELECT", rowCount: 0, oid: 0, rows: [], fields: [] };
}

export abstract class WbClustersRepositoryAdvertisingSheetQueryMapLoader extends WbClustersRepositoryAdvertisingSheetCoreQueryLoader {
  /** Дёшево (индекс по nm_id): сколько строк «вселенной запросов» у товара. */
  protected async countCabinetQueryUniverse(pool: Pool, nmId: number): Promise<number> {
    const result = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM ${this.tableName("wb_cabinet_cluster_queries")} WHERE nm_id = $1`,
      [nmId],
    );
    return Number(result.rows[0]?.cnt ?? 0) || 0;
  }

  protected async loadProductAdvertisingSheetQueryRows(
    pool: Pool,
    nmId: number,
  ): Promise<{
    clusterQueriesResult: QueryResult<SheetClusterQueryRow>;
    cabinetClusterQueriesResult: QueryResult<SheetCabinetClusterQueryRow>;
  }> {
    // Гейт от heap OOM: у товара-монстра тяжёлую загрузку (вся wb_cabinet_cluster_queries
    // в JS, до 216k строк) ПРОПУСКАЕМ — иначе одна сборка пробивает heap и роняет весь
    // бэкенд. Лист строится с пустыми clusterQueries; первый экран фронта их не использует
    // (кампании/таблица идут из /workspace + SQL-direct cluster-table). Порог —
    // WB_SHEET_BUILD_MAX_QUERY_ROWS.
    const cabinetCount = await this.countCabinetQueryUniverse(pool, nmId);
    if (cabinetCount > appEnv.wbSheetBuildMaxQueryRows) {
      this.logger.warn(
        `Сборка рекламного листа nmId=${nmId}: query-universe ${cabinetCount} > ` +
          `${appEnv.wbSheetBuildMaxQueryRows} — тяжёлая загрузка пропущена (защита от heap OOM), ` +
          `clusterQueries будут пустыми.`,
      );
      return {
        clusterQueriesResult: emptyQueryResult<SheetClusterQueryRow>(),
        cabinetClusterQueriesResult: emptyQueryResult<SheetCabinetClusterQueryRow>(),
      };
    }
    const [clusterQueriesResult, cabinetClusterQueriesResult] = await Promise.all([
      pool.query<SheetClusterQueryRow>(
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
          ON ${this.buildFrequencyJoinCondition("f", "cq.normalized_query_text")}
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
      pool.query<SheetCabinetClusterQueryRow>(
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
          ON ${this.buildFrequencyJoinCondition("f", "cq.normalized_query_text")}
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
