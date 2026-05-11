import type {
  ClusterActionSyncStatus,
  ClusterBidSyncStatus,
  ClusterSourceKind,
} from "./wb-clusters.types";
import type {
  ProductAdvertisingWorkspaceCampaignTab,
  ProductAdvertisingWorkspaceCampaignTotals,
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingWorkspaceResponse,
} from "./types/product-advertising-workspace.types";
import type {
  ProductAdvertisingClusterQuery,
} from "./types/product-advertising-sheet.types";
import type { ProductAdvertisingWorkspaceCampaignRowsSnapshot } from "./product-workspace-snapshot.types";
import type { ProductAdvertisingWorkspaceClusterQueriesSnapshot } from "./product-workspace-snapshot.types";
import {
  buildWorkspaceClusterKey,
  normalizeClusterSearchText,
} from "./product-workspace-cluster-table.filters";
import { WbClustersRepositoryAdvertisingSheetBuilder } from "./wb-clusters.repository.advertising-sheet-builder";

interface WorkspaceFastSqlRow {
  advert_id: string | null;
  campaign_name: string | null;
  campaign_type: number | null;
  campaign_status: number | null;
  payment_type: string | null;
  bid_type: string | null;
  currency: string | null;
  cluster_name: string;
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
export abstract class WbClustersRepositoryWorkspaceFastSql extends WbClustersRepositoryAdvertisingSheetBuilder {
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
      query_counts AS (
        SELECT
          advert_id,
          LOWER(TRIM(cluster_name))                           AS norm_cluster_name,
          COUNT(DISTINCT normalized_query_text)::text         AS cnt
        FROM ${this.tableName("wb_cabinet_cluster_queries")}
        WHERE nm_id = $1
          AND advert_id = $2
        GROUP BY advert_id, LOWER(TRIM(cluster_name))
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
        COALESCE(f.monthly_frequency, cn_f.monthly_frequency)::text  AS monthly_frequency,
        pm.updated_at                                                AS updated_at
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
        AND qc.norm_cluster_name = LOWER(TRIM(c.cluster_name))
      LEFT JOIN ${this.tableName("wb_search_query_frequencies")} f
        ON f.normalized_query_text = c.normalized_cluster_name
      LEFT JOIN ${this.tableName("wb_search_query_frequencies")} cn_f
        ON cn_f.normalized_query_text = LOWER(TRIM(c.cluster_name))
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

    const rows: ProductAdvertisingWorkspaceClusterRow[] = result.rows.map((row) => ({
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
      jamQueryCount: null,
      jamFrequency: null,
      jamClicks: null,
      jamAddToCart: null,
      jamOrders: null,
      jamAvgPosition: null,
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

  /**
   * SQL-direct fast path для workspace shell — строит полный заголовок рабочего
   * пространства (кампании, даты, суммарные метрики) одним CTE-запросом к PostgreSQL.
   * Работает для ЛЮБОГО диапазона дат без предварительной материализации.
   * Ожидаемая задержка: < 150 мс (индексы по nm_id + stat_date).
   *
   * Возвращает null если у продукта нет активных кампаний в системе.
   */
  async getWorkspaceShellDirectSQL(
    nmId: number,
    period: { start: string; end: string },
  ): Promise<ProductAdvertisingWorkspaceResponse | null> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    type ShellRow = {
      advert_id: string;
      campaign_name: string | null;
      campaign_type: number | null;
      campaign_status: number | null;
      payment_type: string | null;
      bid_type: string | null;
      currency: string | null;
      synced_at: string | null;
      active_count: string;
      excluded_count: string;
      total_count: string;
      views: string | null;
      clicks: string | null;
      orders: string | null;
      add_to_cart: string | null;
      spend: string | null;
      global_min_date: string | null;
      global_max_date: string | null;
      vendor_code: string | null;
      product_name: string | null;
      brand_name: string | null;
      subject_name: string | null;
    };

    const result = await pool.query<ShellRow>(
      `
      WITH period_agg AS (
        SELECT
          advert_id,
          SUM(views)                        AS views,
          SUM(clicks)                       AS clicks,
          SUM(orders)                       AS orders,
          SUM(add_to_cart)                  AS add_to_cart,
          SUM(spend)                        AS spend,
          MAX(currency)                     AS currency
        FROM ${this.tableName("wb_cluster_daily_stats")}
        WHERE nm_id = $1
          AND stat_date BETWEEN $2::date AND $3::date
        GROUP BY advert_id
      ),
      date_bounds AS (
        SELECT
          MIN(stat_date)::text              AS global_min_date,
          MAX(stat_date)::text              AS global_max_date
        FROM ${this.tableName("wb_cluster_daily_stats")}
        WHERE nm_id = $1
      ),
      cluster_counts AS (
        SELECT
          advert_id,
          COUNT(*) FILTER (
            WHERE source_kind = 'active' AND is_active IS NOT FALSE
          )                                 AS active_count,
          COUNT(*) FILTER (
            WHERE source_kind = 'excluded' OR is_active = FALSE
          )                                 AS excluded_count,
          COUNT(*)                          AS total_count
        FROM ${this.tableName("wb_clusters")}
        WHERE nm_id = $1
          AND (source_kind IN ('active', 'excluded') OR is_active = FALSE)
        GROUP BY advert_id
      )
      SELECT
        cam.advert_id::text,
        cam.name                                          AS campaign_name,
        cam.campaign_type,
        cam.campaign_status,
        cam.payment_type,
        cam.bid_type,
        COALESCE(pa.currency, cam.currency)               AS currency,
        cam.synced_at::text,
        COALESCE(cc.active_count, 0)::text                AS active_count,
        COALESCE(cc.excluded_count, 0)::text              AS excluded_count,
        COALESCE(cc.total_count, 0)::text                 AS total_count,
        pa.views::text,
        pa.clicks::text,
        pa.orders::text,
        pa.add_to_cart::text,
        pa.spend::text,
        db.global_min_date,
        db.global_max_date,
        cat.vendor_code,
        cat.product_name,
        cat.brand_name,
        cat.subject_name
      FROM ${this.tableName("wb_campaigns")} cam
      JOIN ${this.tableName("wb_campaign_products")} cp
        ON cp.advert_id = cam.advert_id AND cp.nm_id = $1
      CROSS JOIN date_bounds db
      LEFT JOIN period_agg pa
        ON pa.advert_id = cam.advert_id
      LEFT JOIN cluster_counts cc
        ON cc.advert_id = cam.advert_id
      LEFT JOIN ${this.tableName("wb_product_catalog")} cat
        ON cat.nm_id = $1
      WHERE cp.nm_id = $1
      ORDER BY COALESCE(pa.spend, 0) DESC, cam.advert_id
      `,
      [nmId, period.start, period.end],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const n = (v: string | null): number | null => (v !== null ? Number(v) : null);

    const firstRow = result.rows[0];
    const globalMinDate = firstRow.global_min_date ?? null;
    const globalMaxDate = firstRow.global_max_date ?? null;

    const campaignTabs: ProductAdvertisingWorkspaceCampaignTab[] = result.rows.map((row) => {
      const views = n(row.views) ?? 0;
      const clicks = n(row.clicks) ?? 0;
      const orders = n(row.orders) ?? 0;
      const addToCart = n(row.add_to_cart) ?? 0;
      const spend = n(row.spend) ?? 0;
      const activeCount = n(row.active_count) ?? 0;
      const excludedCount = n(row.excluded_count) ?? 0;

      const totals: ProductAdvertisingWorkspaceCampaignTotals = {
        spend,
        orders,
        clicks,
        views,
        addToCart,
        ctr: views > 0 ? clicks / views : null,
        ctc: clicks > 0 ? addToCart / clicks : null,
        cto: addToCart > 0 ? orders / addToCart : null,
        cpc: clicks > 0 ? spend / clicks : null,
        cpm: views > 0 ? (spend / views) * 1000 : null,
        cpo: orders > 0 ? spend / orders : null,
        viewToOrder: views > 0 ? orders / views : null,
        activeCount,
        excludedCount,
      };

      return {
        advertId: Number(row.advert_id),
        campaignName: row.campaign_name,
        campaignStatus: row.campaign_status,
        paymentType: row.payment_type,
        bidType: row.bid_type,
        currency: row.currency,
        syncedAt: row.synced_at,
        rowsCount: n(row.total_count) ?? 0,
        totals,
      };
    });

    const defaultCampaignId = campaignTabs[0]?.advertId ?? null;

    return {
      nmId,
      checkedAt: new Date().toISOString(),
      readiness: {
        scope: "workspace",
        status: "ready",
        source: "sql_direct",
        materializationStatus: "sql_direct",
      },
      header: {
        nmId,
        vendorCode: firstRow.vendor_code ?? null,
        productName: firstRow.product_name ?? null,
        brandName: firstRow.brand_name ?? null,
        subjectName: firstRow.subject_name ?? null,
      },
      snapshot: {
        status: "ready" as const,
        fit: "exact" as const,
        source: "live_read_model" as const,
        builtAt: new Date().toISOString(),
        requestedStartDate: period.start,
        requestedEndDate: period.end,
        snapshotStartDate: period.start,
        snapshotEndDate: period.end,
        builtFromExportRequestId: null,
        lastError: null,
      },
      range: {
        startDate: period.start,
        endDate: period.end,
        jamStatus: "pending" as const,
        jamIncluded: false,
      },
      dateBounds: {
        minDate: globalMinDate,
        maxDate: globalMaxDate,
        defaultStartDate: period.start,
        defaultEndDate: period.end,
      },
      campaignTabs,
      defaultCampaignId,
      selectedCampaignSummary: campaignTabs.find((t) => t.advertId === defaultCampaignId) ?? null,
      initialClusterTable: null,
      syncState: {
        hasPendingClusterSync: false,
        refreshStatus: "idle",
        syncRunId: null,
        startedAt: null,
      },
      diagnostics: {
        periodMetricsStatus: "exact",
        periodMetricsActualStartDate: period.start,
        periodMetricsActualEndDate: period.end,
        dailyStatsWindowStartDate: globalMinDate,
        dailyStatsWindowEndDate: globalMaxDate,
        queryCoverageStatus: "ready",
      },
    };
  }

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
  ): Promise<ProductAdvertisingWorkspaceClusterQueriesSnapshot> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    // Cabinet queries are authoritative. Try cabinet first; fall back to wb_cluster_queries
    // only when no cabinet data exists for this cluster (older promotion-type campaigns).
    // The NOT EXISTS approach was O(n²) — replaced with two sequential queries.
    const cabinetResult = await pool.query<{
      query_text: string;
      normalized_query_text: string;
      source_kind: ClusterSourceKind | null;
      is_active: boolean | null;
      cabinet_snapshot_at: string | null;
      is_cabinet_backed: boolean;
      monthly_frequency: string | null;
      updated_at: string | null;
    }>(
      `
      SELECT DISTINCT ON (cq.normalized_query_text)
        cq.query_text,
        cq.normalized_query_text,
        COALESCE(cl.source_kind, 'query-map')::text  AS source_kind,
        cl.is_active                                  AS is_active,
        cq.captured_at::text                          AS cabinet_snapshot_at,
        TRUE                                          AS is_cabinet_backed,
        f.monthly_frequency::text                     AS monthly_frequency,
        cq.synced_at::text                            AS updated_at
      FROM ${this.tableName("wb_cabinet_cluster_queries")} cq
      LEFT JOIN ${this.tableName("wb_clusters")} cl
        ON cl.nm_id = cq.nm_id
        AND cl.advert_id = cq.advert_id
        AND cl.normalized_cluster_name = cq.normalized_cluster_name
      LEFT JOIN ${this.tableName("wb_search_query_frequencies")} f
        ON f.normalized_query_text = cq.normalized_query_text
      WHERE cq.nm_id = $1
        AND cq.advert_id = $2
        AND cq.normalized_cluster_name = $3
      ORDER BY cq.normalized_query_text, f.monthly_frequency DESC NULLS LAST, cq.captured_at DESC
      `,
      [nmId, advertId, normalizedClusterName],
    );

    // If cabinet has data, use it exclusively. Otherwise fall back to promotion queries.
    const result = cabinetResult.rows.length > 0
      ? cabinetResult
      : await pool.query<{
          query_text: string;
          normalized_query_text: string;
          source_kind: ClusterSourceKind | null;
          is_active: boolean | null;
          cabinet_snapshot_at: string | null;
          is_cabinet_backed: boolean;
          monthly_frequency: string | null;
          updated_at: string | null;
        }>(
          `
          SELECT DISTINCT ON (cq.normalized_query_text)
            cq.query_text,
            cq.normalized_query_text,
            COALESCE(cl.source_kind, 'query-map')::text  AS source_kind,
            cl.is_active                                  AS is_active,
            NULL                                          AS cabinet_snapshot_at,
            FALSE                                         AS is_cabinet_backed,
            f.monthly_frequency::text                     AS monthly_frequency,
            cq.synced_at::text                            AS updated_at
          FROM ${this.tableName("wb_cluster_queries")} cq
          LEFT JOIN ${this.tableName("wb_clusters")} cl
            ON cl.nm_id = cq.nm_id
            AND cl.advert_id = cq.advert_id
            AND cl.normalized_cluster_name = cq.normalized_cluster_name
          LEFT JOIN ${this.tableName("wb_search_query_frequencies")} f
            ON f.normalized_query_text = cq.normalized_query_text
          WHERE cq.nm_id = $1
            AND cq.advert_id = $2
            AND cq.normalized_cluster_name = $3
          ORDER BY cq.normalized_query_text, f.monthly_frequency DESC NULLS LAST, cq.synced_at DESC
          `,
          [nmId, advertId, normalizedClusterName],
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
        jamFrequency: null,
        jamClicks: null,
        jamAddToCart: null,
        jamOrders: null,
        jamAvgPosition: null,
        jamOpenToCart: null,
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
