import type { ClusterSourceKind } from "./wb-clusters.types";
import type { ProductAdvertisingClusterQuery } from "./types/product-advertising-sheet.types";
import type { ProductAdvertisingWorkspaceClusterQueriesSnapshot } from "./product-workspace-snapshot.types";
import {
  buildWorkspaceClusterKey,
  normalizeClusterSearchText,
} from "./product-workspace-cluster-table.filters";
import { WbClustersRepositoryAdvertisingSheetBuilder } from "./wb-clusters.repository.advertising-sheet-builder";

/**
 * SQL-direct fast path для drill-down запросов кластера (раскрытие кластера) и
 * для поискового индекса запросов. Вынесено из wb-clusters.repository.workspace-fast-sql.ts
 * как отдельная ответственность «чтение запросов внутри кластера», чтобы тот файл
 * не разрастался. Звено цепочки репозитория: WorkspaceFastSql extends этот класс.
 */
export abstract class WbClustersRepositoryClusterQueriesSql extends WbClustersRepositoryAdvertisingSheetBuilder {
  /**
   * SQL-direct fast path for the cluster query drill-down.
   * Reads individual queries for a specific cluster directly from
   * wb_cabinet_cluster_queries + wb_cluster_queries without PATH B.
   * Expected latency: < 100 ms (indexed lookup by nm_id + advert_id + normalized_cluster_name).
   */
  async getWorkspaceClusterQueriesSQL(
    nmId: number,
    advertId: number,
    normalizedClusterName: string,
    period?: { start: string; end: string } | null,
  ): Promise<ProductAdvertisingWorkspaceClusterQueriesSnapshot> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    // Cabinet queries are authoritative. Try cabinet first; fall back to wb_cluster_queries
    // only when no cabinet data exists for this cluster (older promotion-type campaigns).
    // The NOT EXISTS approach was O(n²) — replaced with two sequential queries.
    //
    // JAM per-query metrics must reflect the SAME period as the cluster row the
    // user expanded. We mirror getProductWorkspaceCampaignRowsSQL: prefer daily
    // snapshots inside the requested range, fall back to the latest bulk monthly
    // snapshot only when there are no daily rows AND the range itself is >= 28
    // days. When no period is given we keep the original latest-bulk behaviour.
    const hasPeriod = !!period;
    const jamSnapshotKeysCte = hasPeriod
      ? `effective_jam AS (
          SELECT snapshot_key
          FROM ${this.tableName("wb_product_search_text_range_snapshots")}
          WHERE nm_id = $1
            AND start_date = end_date
            AND start_date BETWEEN $4::date AND $5::date
          UNION ALL
          SELECT snapshot_key
          FROM ${this.tableName("wb_product_search_text_range_snapshots")}
          WHERE nm_id = $1
            AND (end_date - start_date) >= 28
            AND NOT EXISTS (
              SELECT 1 FROM ${this.tableName("wb_product_search_text_range_snapshots")} d
              WHERE d.nm_id = $1 AND d.start_date = d.end_date
                AND d.start_date BETWEEN $4::date AND $5::date
            )
            AND ($5::date - $4::date) >= 28
          ORDER BY snapshot_key
        )`
      : `effective_jam AS (
          SELECT snapshot_key
          FROM ${this.tableName("wb_product_search_text_range_snapshots")}
          WHERE nm_id = $1 AND (end_date - start_date) >= 28
          ORDER BY synced_at DESC LIMIT 1
        )`;

    // Aggregate JAM metrics per query across ALL selected snapshot keys (one per
    // day when daily, or a single bulk key). Matches the SUM/weighted-avg shape
    // used for the cluster row in getProductWorkspaceCampaignRowsSQL.
    const jamByQueryCte = `jam_by_query AS (
        SELECT
          r.normalized_query_text,
          SUM(COALESCE(r.frequency, r.week_frequency))::text AS jam_frequency,
          SUM(r.open_card_current)::text                     AS jam_clicks,
          SUM(r.add_to_cart_current)::text                   AS jam_add_to_cart,
          SUM(r.orders_current)::text                        AS jam_orders,
          SUM(r.open_to_cart_current)::text                  AS jam_open_to_cart,
          (CASE
            WHEN SUM(r.open_card_current) > 0
              THEN SUM(r.avg_position_current * r.open_card_current)
                     / SUM(r.open_card_current)
            ELSE AVG(r.avg_position_current)
          END)::text                                         AS jam_avg_position
        FROM ${this.tableName("wb_product_search_text_range_rows")} r
        JOIN effective_jam ej ON ej.snapshot_key = r.snapshot_key
        GROUP BY r.normalized_query_text
      )`;

    // Окно СОСТАВА кластера расцеплено с окном ЧИСЕЛ выше. Какие запросы попадают
    // в строки — определяет КОРОТКОЕ свежее окно (последние 7 дней от конца
    // выбранного периода), а не весь период. Цель: в раскрытом кластере видны
    // только запросы, по которым товар реально был релевантен недавно (меньше и
    // актуальнее), при этом числа рядом по-прежнему суммируются за весь период.
    // Период по отдельной фразе есть ТОЛЬКО в JAM-снапшотах (подневные), поэтому
    // 7-дневный состав берём оттуда; кабинетная принадлежность периода не имеет.
    const COMPOSITION_LOOKBACK_DAYS = 7;
    const compositionCte = hasPeriod
      ? `,
        composition_jam AS (
          SELECT DISTINCT r.normalized_query_text
          FROM ${this.tableName("wb_product_search_text_range_snapshots")} s
          JOIN ${this.tableName("wb_product_search_text_range_rows")} r
            ON r.snapshot_key = s.snapshot_key
          WHERE s.nm_id = $1
            AND s.start_date = s.end_date
            AND s.start_date BETWEEN ($5::date - ${COMPOSITION_LOOKBACK_DAYS - 1}) AND $5::date
        )`
      : "";
    // Оставляем запрос, только если по нему была JAM-активность в окне состава.
    // Fallback: если за последние 7 дней у товара вообще НЕТ подневного JAM
    // (composition_jam пуст) — показываем полный кабинетный список, чтобы кластер
    // не выглядел пустым/сломанным.
    const compositionFilter = hasPeriod
      ? `AND (
          EXISTS (SELECT 1 FROM composition_jam cj WHERE cj.normalized_query_text = cq.normalized_query_text)
          OR NOT EXISTS (SELECT 1 FROM composition_jam)
        )`
      : "";

    const params = hasPeriod
      ? [nmId, advertId, normalizedClusterName, period!.start, period!.end]
      : [nmId, advertId, normalizedClusterName];

    type ClusterQueryRow = {
      query_text: string;
      normalized_query_text: string;
      source_kind: ClusterSourceKind | null;
      is_active: boolean | null;
      cabinet_snapshot_at: string | null;
      is_cabinet_backed: boolean;
      monthly_frequency: string | null;
      updated_at: string | null;
      jam_frequency: string | null;
      jam_clicks: string | null;
      jam_add_to_cart: string | null;
      jam_orders: string | null;
      jam_avg_position: string | null;
      jam_open_to_cart: string | null;
    };
    // Drill-down: одна строка на identity запроса. Из пунктуационных вариантов
    // ("клетка для собак", "Клетка, для собак", "клетка.для.собак.") оставляем
    // одного представителя — предпочитая «канонический» вариант, у которого
    // normalized_query_text равен identity (без лишней пунктуации). Без этого
    // дубли надували сумму monthly_frequency на UI и захламляли таблицу.
    const cabinetIdentityExpr = `COALESCE(cq.normalized_query_identity, ${this.normalizedQueryIdentitySql("cq.normalized_query_text")})`;
    const cabinetResult = await pool.query<ClusterQueryRow>(
      `
      WITH ${jamSnapshotKeysCte},
      ${jamByQueryCte}${compositionCte}
      SELECT DISTINCT ON (${cabinetIdentityExpr})
        cq.query_text,
        cq.normalized_query_text,
        COALESCE(cl.source_kind, 'query-map')::text  AS source_kind,
        cl.is_active                                  AS is_active,
        cq.captured_at::text                          AS cabinet_snapshot_at,
        TRUE                                          AS is_cabinet_backed,
        f.monthly_frequency::text                     AS monthly_frequency,
        cq.synced_at::text                            AS updated_at,
        jam.jam_frequency                             AS jam_frequency,
        jam.jam_clicks                                AS jam_clicks,
        jam.jam_add_to_cart                           AS jam_add_to_cart,
        jam.jam_orders                                AS jam_orders,
        jam.jam_avg_position                          AS jam_avg_position,
        jam.jam_open_to_cart                          AS jam_open_to_cart
      FROM ${this.tableName("wb_cabinet_cluster_queries")} cq
      LEFT JOIN ${this.tableName("wb_clusters")} cl
        ON cl.nm_id = cq.nm_id
        AND cl.advert_id = cq.advert_id
        AND cl.normalized_cluster_name = cq.normalized_cluster_name
      LEFT JOIN ${this.tableName("wb_search_query_frequencies")} f
        ON ${this.buildFrequencyJoinCondition("f", "cq.normalized_query_text")}
      LEFT JOIN jam_by_query jam
        ON jam.normalized_query_text = cq.normalized_query_text
      WHERE cq.nm_id = $1
        AND cq.advert_id = $2
        AND cq.normalized_cluster_name = $3
        ${compositionFilter}
      ORDER BY
        ${cabinetIdentityExpr},
        CASE WHEN cq.normalized_query_text = ${cabinetIdentityExpr} THEN 0 ELSE 1 END,
        f.monthly_frequency DESC NULLS LAST,
        cq.captured_at DESC
      `,
      params,
    );

    // If cabinet has data, use it exclusively. Otherwise fall back to promotion queries.
    const result = cabinetResult.rows.length > 0
      ? cabinetResult
      : await pool.query<ClusterQueryRow>(
          `
          WITH ${jamSnapshotKeysCte},
          ${jamByQueryCte}${compositionCte}
          SELECT DISTINCT ON (${this.normalizedQueryIdentitySql("cq.normalized_query_text")})
            cq.query_text,
            cq.normalized_query_text,
            COALESCE(cl.source_kind, 'query-map')::text  AS source_kind,
            cl.is_active                                  AS is_active,
            NULL                                          AS cabinet_snapshot_at,
            FALSE                                         AS is_cabinet_backed,
            f.monthly_frequency::text                     AS monthly_frequency,
            cq.synced_at::text                            AS updated_at,
            jam.jam_frequency                             AS jam_frequency,
            jam.jam_clicks                                AS jam_clicks,
            jam.jam_add_to_cart                           AS jam_add_to_cart,
            jam.jam_orders                                AS jam_orders,
            jam.jam_avg_position                          AS jam_avg_position,
            jam.jam_open_to_cart                          AS jam_open_to_cart
          FROM ${this.tableName("wb_cluster_queries")} cq
          LEFT JOIN ${this.tableName("wb_clusters")} cl
            ON cl.nm_id = cq.nm_id
            AND cl.advert_id = cq.advert_id
            AND cl.normalized_cluster_name = cq.normalized_cluster_name
          LEFT JOIN ${this.tableName("wb_search_query_frequencies")} f
            ON ${this.buildFrequencyJoinCondition("f", "cq.normalized_query_text")}
          LEFT JOIN jam_by_query jam
            ON jam.normalized_query_text = cq.normalized_query_text
          WHERE cq.nm_id = $1
            AND cq.advert_id = $2
            AND cq.normalized_cluster_name = $3
            ${compositionFilter}
          ORDER BY
            ${this.normalizedQueryIdentitySql("cq.normalized_query_text")},
            CASE WHEN cq.normalized_query_text = ${this.normalizedQueryIdentitySql("cq.normalized_query_text")} THEN 0 ELSE 1 END,
            f.monthly_frequency DESC NULLS LAST,
            cq.synced_at DESC
          `,
          params,
        );

    // Deduplicate across both sources: cabinet takes priority for the same query text.
    const seen = new Set<string>();
    const queries: ProductAdvertisingClusterQuery[] = [];
    for (const row of result.rows) {
      const key = row.query_text.trim().toLocaleLowerCase("ru");
      if (seen.has(key)) continue;
      seen.add(key);

      queries.push({
        advertId,
        clusterName: normalizedClusterName,
        queryText: row.query_text,
        querySource: row.is_cabinet_backed ? "cabinet-private-api" : "query-map",
        mappingSource: row.is_cabinet_backed ? "cabinet" : "promotion",
        matchConfidence: "trusted-source",
        isFrequencyBacked: row.monthly_frequency !== null,
        isClusterConfirmed: true,
        isCanonicalClusterQuery: true,
        isCabinetBacked: row.is_cabinet_backed,
        cabinetSnapshotAt: row.cabinet_snapshot_at,
        sourceKind: (row.source_kind as ClusterSourceKind) ?? "query-map",
        isActive: row.is_active,
        views: null,
        clicks: null,
        orders: null,
        addToCart: null,
        shks: null,
        jamFrequency: row.jam_frequency !== null ? Number(row.jam_frequency) : null,
        jamClicks: row.jam_clicks !== null ? Number(row.jam_clicks) : null,
        jamAddToCart: row.jam_add_to_cart !== null ? Number(row.jam_add_to_cart) : null,
        jamOrders: row.jam_orders !== null ? Number(row.jam_orders) : null,
        jamAvgPosition: row.jam_avg_position !== null ? Number(row.jam_avg_position) : null,
        jamOpenToCart: row.jam_open_to_cart !== null ? Number(row.jam_open_to_cart) : null,
        monthlyFrequency: row.monthly_frequency !== null ? Number(row.monthly_frequency) : null,
        updatedAt: row.updated_at,
      });
    }

    return {
      checkedAt: new Date().toISOString(),
      queries,
    };
  }

  /**
   * Builds the query search index for a campaign directly from DB without PATH B.
   * Used by the cluster-table read path so frontend local search works on the
   * first request without waiting for a materialized snapshot.
   * Indexed by (nm_id, advert_id, normalized_cluster_name) on both tables —
   * expected latency < 100 ms for any single campaign.
   */
  async getQuerySearchIndexSQL(
    nmId: number,
    advertId: number,
  ): Promise<Record<string, string[]>> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    // Cabinet queries take priority; promotion queries fill only the clusters
    // not yet covered by the cabinet snapshot.
    const result = await pool.query<{ cluster_name: string; query_text: string }>(
      `
      SELECT cluster_name, query_text
      FROM ${this.tableName("wb_cabinet_cluster_queries")}
      WHERE nm_id = $1 AND advert_id = $2
      UNION ALL
      SELECT wq.cluster_name, wq.query_text
      FROM ${this.tableName("wb_cluster_queries")} wq
      WHERE wq.nm_id = $1 AND wq.advert_id = $2
        AND NOT EXISTS (
          SELECT 1 FROM ${this.tableName("wb_cabinet_cluster_queries")} ccq
          WHERE ccq.nm_id = $1 AND ccq.advert_id = $2
            AND ccq.normalized_cluster_name = wq.normalized_cluster_name
        )
      `,
      [nmId, advertId],
    );

    const index: Record<string, string[]> = {};
    for (const row of result.rows) {
      const clusterKey = buildWorkspaceClusterKey(advertId, row.cluster_name);
      const normalizedText = normalizeClusterSearchText(row.query_text);
      if (!normalizedText) continue;
      if (!index[clusterKey]) {
        index[clusterKey] = [];
      }
      index[clusterKey].push(normalizedText);
    }
    return index;
  }
}
