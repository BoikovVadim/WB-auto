import type {
  ClusterActionSyncStatus,
  ClusterBidSyncStatus,
  ClusterSourceKind,
} from "./wb-clusters.types";
import type { ProductAdvertisingWorkspaceClusterRow } from "./types/product-advertising-workspace.types";
import type { ProductAdvertisingWorkspaceCampaignRowsSnapshot } from "./product-workspace-snapshot.types";
import { buildWorkspaceClusterKey } from "./product-workspace-cluster-table.filters";
import { CLUSTER_COMPOSITION_LOOKBACK_DAYS } from "./wb-clusters.repository.cluster-queries-sql";
import { WbClustersRepositoryWorkspaceShellSql } from "./wb-clusters.repository.workspace-shell-sql";

interface WorkspaceFastSqlRow {
  advert_id: string | null;
  campaign_name: string | null;
  campaign_type: number | null;
  campaign_status: number | null;
  payment_type: string | null;
  bid_type: string | null;
  currency: string | null;
  cluster_name: string;
  normalized_cluster_name: string;
  canonical_norm_query: string;
  source_kind: ClusterSourceKind;
  is_active: boolean | null;
  views: string | null;
  clicks: string | null;
  orders: string | null;
  add_to_cart: string | null;
  shks: string | null;
  spend: string | null;
  avg_position: string | null;
  ctr: string | null;
  cpc: string | null;
  cpm: string | null;
  bid: string | null;
  bid_sync_status: ClusterBidSyncStatus | null;
  bid_confirmed_at: string | null;
  bid_retry_at: string | null;
  bid_last_error: string | null;
  action_sync_status: ClusterActionSyncStatus | null;
  action_retry_at: string | null;
  action_last_error: string | null;
  query_count: string | null;
  monthly_frequency: string | null;
  updated_at: string | null;
  jam_query_count: string | null;
  jam_frequency: string | null;
  jam_clicks: string | null;
  jam_add_to_cart: string | null;
  jam_orders: string | null;
  jam_avg_position: string | null;
}

/**
 * SQL-direct fast path: computes workspace campaign rows for a specific
 * (nmId, advertId, period) in a single CTE query without PATH B.
 * Expected latency: < 500 ms vs 35–40 s for cold PATH B.
 * Produces period-aggregated metrics from wb_cluster_daily_stats plus
 * cluster metadata from wb_clusters/wb_campaigns/wb_cluster_bids/wb_cluster_actions.
 * JAM fields and querySearchIndex are left empty; PATH B (running in background)
 * will overwrite once it completes.
 */
export abstract class WbClustersRepositoryWorkspaceFastSql extends WbClustersRepositoryWorkspaceShellSql {
  async getProductWorkspaceCampaignRowsSQL(
    nmId: number,
    advertId: number,
    period: { start: string; end: string },
  ): Promise<ProductAdvertisingWorkspaceCampaignRowsSnapshot> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    const result = await pool.query<WorkspaceFastSqlRow>(
      `
      WITH period_agg AS (
        SELECT
          advert_id,
          LOWER(TRIM(cluster_name))           AS norm_cluster_name,
          SUM(views)::text                    AS views,
          SUM(clicks)::text                   AS clicks,
          SUM(orders)::text                   AS orders,
          SUM(add_to_cart)::text              AS add_to_cart,
          SUM(shks)::text                     AS shks,
          SUM(spend)::text                    AS spend,
          AVG(NULLIF(avg_position, 0))::text  AS avg_position,
          MAX(currency)                       AS currency,
          MAX(synced_at)::text                AS updated_at
        FROM ${this.tableName("wb_cluster_daily_stats")}
        WHERE nm_id = $1
          AND advert_id = $2
          AND stat_date BETWEEN $3::date AND $4::date
        GROUP BY advert_id, LOWER(TRIM(cluster_name))
      ),
      -- Единый MATERIALIZED скан cabinet queries: читаем таблицу один раз,
      -- затем получаем COUNT и SUM из in-memory результата без JOIN в 1.5М строк.
      -- Дедуп по identity (а не по normalized_query_text): WB присылает
      -- одинаковые запросы в нескольких пунктуационных вариантах ("клетка для собак",
      -- "клетка, для собак", "клетка.для.собак."), у них одна identity и одна
      -- frequency в wb_search_query_frequencies; денормализованная monthly_frequency
      -- в cabinet строках у всех вариантов одинаковая, поэтому SUM по text-distinct
      -- надувал frequency_by_cluster в N раз.
      cabinet_distinct AS MATERIALIZED (
        SELECT DISTINCT ON (normalized_cluster_name, COALESCE(normalized_query_identity, ${this.normalizedQueryIdentitySql("normalized_query_text")}))
          $2::bigint            AS advert_id,
          $1::bigint            AS nm_id,
          normalized_cluster_name,
          COALESCE(normalized_query_identity, ${this.normalizedQueryIdentitySql("normalized_query_text")}) AS query_identity,
          monthly_frequency
        FROM ${this.tableName("wb_cabinet_cluster_queries")}
        WHERE nm_id = $1 AND advert_id = $2
        ORDER BY
          normalized_cluster_name,
          COALESCE(normalized_query_identity, ${this.normalizedQueryIdentitySql("normalized_query_text")}),
          monthly_frequency DESC NULLS LAST
      ),
      query_counts AS (
        -- COUNT уникальных identity (а не текстов) из cabinet + promotion.
        SELECT
          advert_id,
          nm_id,
          normalized_cluster_name,
          COUNT(DISTINCT query_identity)::text AS cnt
        FROM (
          SELECT advert_id, nm_id, normalized_cluster_name, query_identity
          FROM cabinet_distinct
          UNION ALL
          SELECT advert_id, nm_id, normalized_cluster_name,
                 ${this.normalizedQueryIdentitySql("normalized_query_text")} AS query_identity
          FROM ${this.tableName("wb_cluster_queries")}
          WHERE nm_id = $1 AND advert_id = $2
        ) combined
        GROUP BY advert_id, nm_id, normalized_cluster_name
      ),
      frequency_by_cluster AS (
        -- SUM pre-stored monthly_frequency из cabinet_distinct (in-memory, мгновенно).
        -- monthly_frequency денормализована при импорте cabinet queries.
        SELECT
          advert_id,
          nm_id,
          normalized_cluster_name,
          NULLIF(SUM(monthly_frequency), 0) AS monthly_frequency
        FROM cabinet_distinct
        GROUP BY advert_id, nm_id, normalized_cluster_name
      ),
      -- Дневные снапшоты JAM внутри выбранного диапазона дат.
      -- Если дневных данных нет — падаем на последний bulk-месячный снапшот (>= 28 дней).
      daily_jam_snapshots AS (
        SELECT snapshot_key
        FROM ${this.tableName("wb_product_search_text_range_snapshots")}
        WHERE nm_id     = $1
          AND start_date = end_date
          AND start_date BETWEEN $3::date AND $4::date
      ),
      bulk_jam_snapshot AS (
        SELECT snapshot_key
        FROM ${this.tableName("wb_product_search_text_range_snapshots")}
        WHERE nm_id = $1
          AND (end_date - start_date) >= 28
        ORDER BY synced_at DESC
        LIMIT 1
      ),
      effective_jam_snapshot_keys AS (
        SELECT snapshot_key FROM daily_jam_snapshots
        UNION ALL
        -- Fallback на bulk-месячный только когда:
        -- 1) нет дневных данных за выбранный период, И
        -- 2) выбранный период сам >= 28 дней (иначе показываем пустые JAM-метрики).
        SELECT snapshot_key FROM bulk_jam_snapshot
        WHERE NOT EXISTS (SELECT 1 FROM daily_jam_snapshots)
          AND ($4::date - $3::date) >= 28
      ),
      -- 7-дневное окно СОСТАВА (последние CLUSTER_COMPOSITION_LOOKBACK_DAYS дней от
      -- конца периода). Зеркалит drill-down getWorkspaceClusterQueriesSQL, чтобы
      -- счётчик запросов на строке кластера совпадал с раскрытым списком.
      composition_phrases AS (
        SELECT DISTINCT r.normalized_query_text
        FROM ${this.tableName("wb_product_search_text_range_snapshots")} s
        JOIN ${this.tableName("wb_product_search_text_range_rows")} r
          ON r.snapshot_key = s.snapshot_key
        WHERE s.nm_id = $1
          AND s.start_date = s.end_date
          AND s.start_date BETWEEN ($4::date - ${CLUSTER_COMPOSITION_LOOKBACK_DAYS - 1}) AND $4::date
      ),
      -- Кол-во запросов в кластере, прошедших окно состава (дедуп по identity, как в
      -- drill-down). Fallback: если за окно у товара нет подневного JAM вообще
      -- (composition_phrases пуст) — считаем весь кабинетный список (FILTER истинен
      -- для всех), чтобы счётчик не обнулялся.
      -- ВАЖНО: тот же фильтр качества, что и в getWorkspaceClusterQueriesSQL
      -- (раскрытый список) — считаем ТОЛЬКО запросы с известной частотностью
      -- (monthly_frequency > 0). Без него счётчик включал низко-/безчастотный хвост
      -- (бренд/артикул/сверхдлинные, которых нет в отчётах WB), и свёрнутое число
      -- было больше раскрытого списка. JOIN на частотность 1:1 — таблица
      -- import-deduped по identity.
      composition_query_counts AS (
        SELECT
          combined.advert_id,
          combined.nm_id,
          combined.normalized_cluster_name,
          COUNT(DISTINCT combined.query_identity) FILTER (
            WHERE (
              EXISTS (SELECT 1 FROM composition_phrases cp WHERE cp.normalized_query_text = combined.nqt)
              OR NOT EXISTS (SELECT 1 FROM composition_phrases)
            )
            AND f.monthly_frequency > 0
          )::text AS cnt
        FROM (
          SELECT advert_id, nm_id, normalized_cluster_name,
                 COALESCE(normalized_query_identity, ${this.normalizedQueryIdentitySql("normalized_query_text")}) AS query_identity,
                 normalized_query_text AS nqt
          FROM ${this.tableName("wb_cabinet_cluster_queries")}
          WHERE nm_id = $1 AND advert_id = $2
          UNION ALL
          SELECT advert_id, nm_id, normalized_cluster_name,
                 ${this.normalizedQueryIdentitySql("normalized_query_text")} AS query_identity,
                 normalized_query_text AS nqt
          FROM ${this.tableName("wb_cluster_queries")}
          WHERE nm_id = $1 AND advert_id = $2
        ) combined
        LEFT JOIN ${this.tableName("wb_search_query_frequencies")} f
          ON ${this.buildFrequencyJoinCondition("f", "combined.nqt")}
        GROUP BY combined.advert_id, combined.nm_id, combined.normalized_cluster_name
      ),
      jam_by_cluster AS (
        SELECT
          cq.advert_id,
          LOWER(TRIM(cq.cluster_name))                                    AS norm_cluster_name,
          SUM(COALESCE(r.frequency, r.week_frequency))::text              AS jam_frequency,
          SUM(r.open_card_current)::text                                  AS jam_clicks,
          SUM(r.add_to_cart_current)::text                                AS jam_add_to_cart,
          SUM(r.orders_current)::text                                     AS jam_orders,
          (CASE
            WHEN SUM(r.open_card_current) > 0
              THEN SUM(r.avg_position_current * r.open_card_current)
                     / SUM(r.open_card_current)
            ELSE AVG(r.avg_position_current)
          END)::text                                                      AS jam_avg_position
        FROM ${this.tableName("wb_cabinet_cluster_queries")} cq
        JOIN effective_jam_snapshot_keys ejsk ON TRUE
        JOIN ${this.tableName("wb_product_search_text_range_rows")} r
          ON r.snapshot_key = ejsk.snapshot_key
         AND r.normalized_query_text = cq.normalized_query_text
        WHERE cq.nm_id     = $1
          AND cq.advert_id = $2
        GROUP BY cq.advert_id, LOWER(TRIM(cq.cluster_name))
      )
      SELECT
        c.advert_id::text                                            AS advert_id,
        cam.name                                                     AS campaign_name,
        cam.campaign_type,
        cam.campaign_status,
        cam.payment_type,
        cam.bid_type,
        COALESCE(pm.currency, cam.currency)                          AS currency,
        c.cluster_name,
        c.normalized_cluster_name,
        COALESCE(b.cluster_name, c.cluster_name)                     AS canonical_norm_query,
        CASE
          WHEN a.action_key IS NOT NULL THEN
            CASE WHEN a.desired_is_active THEN 'active' ELSE 'excluded' END
          ELSE c.source_kind
        END::text                                                    AS source_kind,
        COALESCE(a.desired_is_active, c.is_active)                   AS is_active,
        pm.views,
        pm.clicks,
        pm.orders,
        pm.add_to_cart,
        pm.shks,
        pm.spend,
        pm.avg_position,
        CASE WHEN pm.views::numeric > 0
          THEN (pm.clicks::numeric / pm.views::numeric * 100)::text
        END                                                          AS ctr,
        CASE WHEN pm.clicks::numeric > 0
          THEN (pm.spend::numeric / pm.clicks::numeric)::text
        END                                                          AS cpc,
        CASE WHEN pm.views::numeric > 0
          THEN (pm.spend::numeric / pm.views::numeric * 1000)::text
        END                                                          AS cpm,
        COALESCE(b.bid, cp.search_bid, cp.min_search_bid)::text      AS bid,
        CASE
          WHEN b.bid_key IS NOT NULL
            THEN COALESCE(b.bid_sync_status, 'confirmed')
          WHEN cp.search_bid IS NOT NULL THEN 'confirmed'
          WHEN cp.min_search_bid IS NOT NULL THEN 'confirmed'
        END                                                          AS bid_sync_status,
        CASE
          WHEN b.bid_key IS NOT NULL
            AND COALESCE(b.bid_sync_status, 'confirmed') = 'confirmed'
            THEN COALESCE(b.bid_confirmed_at, b.synced_at)::text
          WHEN cp.search_bid IS NOT NULL
            THEN COALESCE(cp.search_bid_synced_at, cp.synced_at)::text
          WHEN cp.min_search_bid IS NOT NULL
            THEN COALESCE(cp.min_search_bid_synced_at, cp.synced_at)::text
        END                                                          AS bid_confirmed_at,
        b.bid_retry_at::text                                         AS bid_retry_at,
        b.bid_last_error,
        a.action_sync_status,
        a.action_retry_at::text                                      AS action_retry_at,
        a.action_last_error,
        qc.cnt                                                       AS query_count,
        freq.monthly_frequency::text                                       AS monthly_frequency,
        pm.updated_at                                                AS updated_at,
        cqc.cnt                                                      AS jam_query_count,
        -- Джем-частотность: сумма frequency из JAM-снапшотов (по тем запросам,
        -- что реально попали в JAM — это, как правило, кластеры с заказами).
        -- Обычная частотность остаётся в monthly_frequency выше.
        jbc.jam_frequency                                                AS jam_frequency,
        jbc.jam_clicks,
        jbc.jam_add_to_cart,
        jbc.jam_orders,
        jbc.jam_avg_position
      FROM ${this.tableName("wb_clusters")} c
      JOIN ${this.tableName("wb_campaign_products")} cp
        ON cp.advert_id = c.advert_id AND cp.nm_id = c.nm_id
      JOIN ${this.tableName("wb_campaigns")} cam
        ON cam.advert_id = c.advert_id
      LEFT JOIN ${this.tableName("wb_cluster_bids")} b
        ON b.advert_id = c.advert_id
        AND b.nm_id = c.nm_id
        AND b.normalized_cluster_name = c.normalized_cluster_name
      LEFT JOIN ${this.tableName("wb_cluster_actions")} a
        ON a.advert_id = c.advert_id
        AND a.nm_id = c.nm_id
        AND a.normalized_cluster_name = c.normalized_cluster_name
      LEFT JOIN period_agg pm
        ON pm.advert_id = c.advert_id
        AND pm.norm_cluster_name = LOWER(TRIM(c.cluster_name))
      LEFT JOIN query_counts qc
        ON qc.advert_id = c.advert_id
        AND qc.nm_id = c.nm_id
        AND qc.normalized_cluster_name = c.normalized_cluster_name
      LEFT JOIN composition_query_counts cqc
        ON cqc.advert_id = c.advert_id
        AND cqc.nm_id = c.nm_id
        AND cqc.normalized_cluster_name = c.normalized_cluster_name
      LEFT JOIN frequency_by_cluster freq
        ON freq.advert_id = c.advert_id
        AND freq.nm_id = c.nm_id
        AND freq.normalized_cluster_name = c.normalized_cluster_name
      LEFT JOIN jam_by_cluster jbc
        ON jbc.advert_id = c.advert_id
        AND jbc.norm_cluster_name = LOWER(TRIM(c.cluster_name))
      WHERE c.nm_id = $1
        AND c.advert_id = $2
        AND (
          a.action_key IS NOT NULL
          OR c.source_kind IN ('active', 'excluded')
          OR c.is_active = FALSE
        )
      ORDER BY COALESCE(pm.spend::numeric, 0) DESC, c.cluster_name
      `,
      [nmId, advertId, period.start, period.end],
    );

    const n = (v: string | null): number | null => (v !== null ? Number(v) : null);

    // Deduplicate rows by (advert_id, normalized_cluster_name), preferring
    // 'active' over 'excluded' over everything else. This guards against the
    // case where wb_clusters contains both an 'active' and an 'excluded' entry
    // for the same cluster (e.g. after a status transition was not fully cleaned
    // up yet by deactivateStaleActiveClusters).
    const sourceKindRank = (sk: ClusterSourceKind | null): number =>
      sk === "active" ? 0 : sk === "excluded" ? 1 : 2;
    const dedupMap = new Map<string, (typeof result.rows)[0]>();
    for (const row of result.rows) {
      const key = `${row.advert_id ?? ""}:${row.normalized_cluster_name}`;
      const existing = dedupMap.get(key);
      if (!existing || sourceKindRank(row.source_kind) < sourceKindRank(existing.source_kind)) {
        dedupMap.set(key, row);
      }
    }
    const dedupedRows = Array.from(dedupMap.values());

    const rows: ProductAdvertisingWorkspaceClusterRow[] = dedupedRows.map((row) => ({
      clusterKey: buildWorkspaceClusterKey(
        row.advert_id !== null ? Number(row.advert_id) : null,
        row.cluster_name,
      ),
      advertId: row.advert_id !== null ? Number(row.advert_id) : null,
      campaignName: row.campaign_name,
      campaignType: row.campaign_type,
      campaignStatus: row.campaign_status,
      paymentType: row.payment_type,
      bidType: row.bid_type,
      currency: row.currency,
      clusterName: row.cluster_name,
      canonicalNormQuery: row.canonical_norm_query,
      queryCount: n(row.query_count),
      jamQueryCount: n(row.jam_query_count),
      jamFrequency: n(row.jam_frequency),
      jamClicks: n(row.jam_clicks),
      jamAddToCart: n(row.jam_add_to_cart),
      jamOrders: n(row.jam_orders),
      jamAvgPosition: n(row.jam_avg_position),
      monthlyFrequency: n(row.monthly_frequency),
      sourceKind: row.source_kind,
      isActive: row.is_active,
      views: n(row.views),
      clicks: n(row.clicks),
      orders: n(row.orders),
      addToCart: n(row.add_to_cart),
      shks: n(row.shks),
      ctr: n(row.ctr),
      avgPosition: n(row.avg_position),
      cpc: n(row.cpc),
      cpm: n(row.cpm),
      spend: n(row.spend),
      bid: n(row.bid),
      bidSyncStatus: row.bid_sync_status,
      bidConfirmedAt: row.bid_confirmed_at,
      bidRetryAt: row.bid_retry_at,
      bidLastError: row.bid_last_error,
      actionSyncStatus: row.action_sync_status,
      actionRetryAt: row.action_retry_at,
      actionLastError: row.action_last_error,
      updatedAt: row.updated_at,
    }));

    const activeRows = rows.filter((r) => r.sourceKind === "active" && r.isActive !== false);
    const excludedRows = rows.filter((r) => r.sourceKind === "excluded" || r.isActive === false);

    return {
      checkedAt: new Date().toISOString(),
      rows,
      filterCounts: {
        all: rows.length,
        active: activeRows.length,
        excluded: excludedRows.length,
      },
      // querySearchIndex populated when PATH B completes and overwrites these rows.
      querySearchIndex: {},
    };
  }

  /**
   * Читает актуальные ставки из wb_cluster_bids для конкретной кампании.
   * Используется для наложения свежих bid-данных поверх сохранённого снэпшота
   * (который может содержать устаревшие ставки, но корректный набор кластеров).
   * Возвращает map: cluster_name.trim().toLowerCase() → bid-поля.
   */
  async getLiveClusterBidsByClusterName(
    nmId: number,
    advertId: number,
  ): Promise<Map<string, {
    bid: number | null;
    bidSyncStatus: import("./wb-clusters.types").ClusterBidSyncStatus | null;
    bidConfirmedAt: string | null;
    bidRetryAt: string | null;
    bidLastError: string | null;
  }>> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{
      cluster_name: string;
      bid: string | null;
      bid_sync_status: import("./wb-clusters.types").ClusterBidSyncStatus | null;
      bid_confirmed_at: string | null;
      bid_retry_at: string | null;
      bid_last_error: string | null;
    }>(
      `
        SELECT
          cluster_name,
          bid::text AS bid,
          bid_sync_status,
          bid_confirmed_at::text AS bid_confirmed_at,
          bid_retry_at::text     AS bid_retry_at,
          bid_last_error
        FROM ${this.tableName("wb_cluster_bids")}
        WHERE nm_id = $1 AND advert_id = $2
      `,
      [nmId, advertId],
    );
    const map = new Map<string, {
      bid: number | null;
      bidSyncStatus: import("./wb-clusters.types").ClusterBidSyncStatus | null;
      bidConfirmedAt: string | null;
      bidRetryAt: string | null;
      bidLastError: string | null;
    }>();
    for (const row of result.rows) {
      map.set(row.cluster_name.trim().toLowerCase(), {
        bid: row.bid !== null ? Number(row.bid) : null,
        bidSyncStatus: row.bid_sync_status,
        bidConfirmedAt: row.bid_confirmed_at,
        bidRetryAt: row.bid_retry_at,
        bidLastError: row.bid_last_error,
      });
    }
    return map;
  }

}
