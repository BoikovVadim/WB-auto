import type {
  ProductAdvertisingWorkspaceCampaignTab,
  ProductAdvertisingWorkspaceCampaignTotals,
  ProductAdvertisingWorkspaceResponse,
} from "./types/product-advertising-workspace.types";
import { buildProductAdvertisingReadModelRevision } from "./product-advertising-read-model-revision";
import { WbClustersRepositoryClusterQueriesSql } from "./wb-clusters.repository.cluster-queries-sql";

/**
 * SQL-direct fast path для workspace shell — заголовок рабочего пространства
 * (кампании, даты, суммарные метрики). Вынесено из
 * wb-clusters.repository.workspace-fast-sql.ts как отдельная ответственность
 * «обзор воркспейса». Звено цепочки: WorkspaceFastSql → этот класс → ClusterQueriesSql.
 */
export abstract class WbClustersRepositoryWorkspaceShellSql extends WbClustersRepositoryClusterQueriesSql {
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
      placements_search: boolean | null;
      placements_recommendations: boolean | null;
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
      has_pending_cluster_sync: boolean;
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
      ),
      pending_sync AS (
        SELECT
          EXISTS (
            SELECT 1
            FROM ${this.tableName("wb_cluster_bids")}
            WHERE nm_id = $1
              AND bid_sync_status IS NOT NULL
              AND bid_sync_status <> 'confirmed'
          )
          OR EXISTS (
            SELECT 1
            FROM ${this.tableName("wb_cluster_actions")}
            WHERE nm_id = $1
              AND action_sync_status IS NOT NULL
              AND action_sync_status <> 'confirmed'
          ) AS has_pending_cluster_sync
      )
      SELECT
        cam.advert_id::text,
        cam.name                                          AS campaign_name,
        cam.campaign_type,
        cam.campaign_status,
        cam.payment_type,
        cam.bid_type,
        cam.placements_search,
        cam.placements_recommendations,
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
        cat.subject_name,
        ps.has_pending_cluster_sync
      FROM ${this.tableName("wb_campaigns")} cam
      JOIN ${this.tableName("wb_campaign_products")} cp
        ON cp.advert_id = cam.advert_id AND cp.nm_id = $1
      CROSS JOIN date_bounds db
      CROSS JOIN pending_sync ps
      LEFT JOIN period_agg pa
        ON pa.advert_id = cam.advert_id
      LEFT JOIN cluster_counts cc
        ON cc.advert_id = cam.advert_id
      LEFT JOIN ${this.tableName("wb_product_catalog")} cat
        ON cat.nm_id = $1
      WHERE cp.nm_id = $1
      ORDER BY
        CASE
          WHEN cam.campaign_status = 9 THEN 0
          WHEN cam.campaign_status = 11 THEN 1
          WHEN cam.campaign_status IS NULL THEN 2
          WHEN cam.campaign_status >= 12 THEN 3
          ELSE 2
        END ASC,
        cam.advert_id DESC
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
        campaignType: row.campaign_type,
        campaignStatus: row.campaign_status,
        paymentType: row.payment_type,
        bidType: row.bid_type,
        placementsSearch: row.placements_search,
        placementsRecommendations: row.placements_recommendations,
        currency: row.currency,
        syncedAt: row.synced_at,
        rowsCount: n(row.total_count) ?? 0,
        totals,
      };
    });

    const defaultCampaignId = campaignTabs[0]?.advertId ?? null;
    const checkedAt = new Date().toISOString();

    return {
      nmId,
      checkedAt,
      revision: buildProductAdvertisingReadModelRevision({
        scope: "workspace",
        nmId,
        requestedStartDate: period.start,
        requestedEndDate: period.end,
        builtAt: checkedAt,
      }),
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
        builtAt: checkedAt,
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
        hasPendingClusterSync: firstRow.has_pending_cluster_sync,
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
}
