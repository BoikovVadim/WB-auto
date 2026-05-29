import { WbClustersRepositoryCostSumSnapshot } from "./wb-clusters.repository.cost-sum-snapshot";

export type JamDailyRow = {
  nmId: number;
  jamDate: string;        // "YYYY-MM-DD"
  avgPosition: number | null;
  bestPosition: number | null;
  totalFrequency: number;
  topFrequency: number;
  totalClicks: number;
  totalAddToCart: number;
  totalOrders: number;
  queryCount: number;
};

/**
 * JAM daily read-model repository.
 *
 * Single source of truth: wb_product_jam_daily(nm_id, jam_date, ...).
 * Materialized nightly from wb_product_search_text_range_rows after JAM sync.
 * Frontend reads with simple SELECT for any date range — no aggregation at query time.
 */
export abstract class WbClustersRepositoryJamDaily extends WbClustersRepositoryCostSumSnapshot {
  /**
   * Aggregates JAM phrase-level rows for a given date into wb_product_jam_daily.
   * Safe to call multiple times for the same date (ON CONFLICT DO UPDATE).
   */
  async materializeJamDailyForDate(date: string): Promise<number> {
    const tbl          = this.tableName("wb_product_jam_daily");
    const snapshots    = this.tableName("wb_product_search_text_range_snapshots");
    const rows         = this.tableName("wb_product_search_text_range_rows");

    const result = await this.getPool().query<{ count: string }>(
      `
      WITH aggregated AS (
        SELECT
          s.nm_id,
          s.start_date                                                               AS jam_date,
          ROUND(
            AVG(r.avg_position_current)
              FILTER (WHERE r.avg_position_current > 0 AND r.avg_position_current < 10000),
            1
          )                                                                          AS avg_position,
          MIN(r.avg_position_current)
            FILTER (WHERE r.avg_position_current > 0 AND r.avg_position_current < 10000)
                                                                                     AS best_position,
          COALESCE(SUM(r.frequency), 0)::BIGINT                                     AS total_frequency,
          COALESCE(MAX(r.frequency), 0)::BIGINT                                     AS top_frequency,
          COALESCE(SUM(r.open_card_current), 0)::INT                                AS total_clicks,
          COALESCE(SUM(r.add_to_cart_current), 0)::INT                              AS total_add_to_cart,
          COALESCE(SUM(r.orders_current), 0)::INT                                   AS total_orders,
          COUNT(*)::INT                                                              AS query_count
        FROM ${snapshots} s
        JOIN ${rows} r ON r.snapshot_key = s.snapshot_key
        WHERE s.start_date = s.end_date
          AND s.start_date = $1::DATE
        GROUP BY s.nm_id, s.start_date
      ),
      upserted AS (
        INSERT INTO ${tbl}
          (nm_id, jam_date, avg_position, best_position,
           total_frequency, top_frequency,
           total_clicks, total_add_to_cart, total_orders,
           query_count, updated_at)
        SELECT
          nm_id, jam_date, avg_position, best_position,
          total_frequency, top_frequency,
          total_clicks, total_add_to_cart, total_orders,
          query_count, NOW()
        FROM aggregated
        ON CONFLICT (nm_id, jam_date) DO UPDATE SET
          avg_position      = EXCLUDED.avg_position,
          best_position     = EXCLUDED.best_position,
          total_frequency   = EXCLUDED.total_frequency,
          top_frequency     = EXCLUDED.top_frequency,
          total_clicks      = EXCLUDED.total_clicks,
          total_add_to_cart = EXCLUDED.total_add_to_cart,
          total_orders      = EXCLUDED.total_orders,
          query_count       = EXCLUDED.query_count,
          updated_at        = NOW()
        RETURNING nm_id
      )
      SELECT COUNT(*)::text AS count FROM upserted
      `,
      [date],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /** All JAM daily rows for all products, newest date first. Used for retrospective matrix. */
  async getJamDailyMatrix(): Promise<JamDailyRow[]> {
    const result = await this.getPool().query<{
      nm_id: string;
      jam_date: string;
      avg_position: string | null;
      best_position: string | null;
      total_frequency: string;
      top_frequency: string;
      total_clicks: string;
      total_add_to_cart: string;
      total_orders: string;
      query_count: string;
    }>(
      `SELECT
         nm_id::text,
         TO_CHAR(jam_date, 'YYYY-MM-DD') AS jam_date,
         avg_position::text,
         best_position::text,
         total_frequency::text,
         top_frequency::text,
         total_clicks::text,
         total_add_to_cart::text,
         total_orders::text,
         query_count::text
       FROM ${this.tableName("wb_product_jam_daily")}
       ORDER BY nm_id ASC, jam_date DESC`,
    );
    return result.rows.map((r) => ({
      nmId:           Number(r.nm_id),
      jamDate:        r.jam_date,
      avgPosition:    r.avg_position != null ? Number(r.avg_position) : null,
      bestPosition:   r.best_position != null ? Number(r.best_position) : null,
      totalFrequency: Number(r.total_frequency),
      topFrequency:   Number(r.top_frequency),
      totalClicks:    Number(r.total_clicks),
      totalAddToCart: Number(r.total_add_to_cart),
      totalOrders:    Number(r.total_orders),
      queryCount:     Number(r.query_count),
    }));
  }

  /**
   * Returns JAM metrics summed/averaged for a specific product and date range.
   * Used by the advertising cluster view to show JAM data alongside campaigns.
   */
  async getJamDailySummaryForProduct(
    nmId: number,
    fromDate: string,
    toDate: string,
  ): Promise<{
    avgPosition: number | null;
    bestPosition: number | null;
    totalFrequency: number;
    topFrequency: number;
    totalClicks: number;
    totalAddToCart: number;
    totalOrders: number;
    avgQueryCount: number;
    dayCount: number;
  } | null> {
    const result = await this.getPool().query<{
      avg_position: string | null;
      best_position: string | null;
      total_frequency: string;
      top_frequency: string;
      total_clicks: string;
      total_add_to_cart: string;
      total_orders: string;
      avg_query_count: string;
      day_count: string;
    }>(
      `SELECT
         ROUND(AVG(avg_position) FILTER (WHERE avg_position IS NOT NULL), 1)::text AS avg_position,
         MIN(best_position) FILTER (WHERE best_position IS NOT NULL)::text           AS best_position,
         COALESCE(SUM(total_frequency), 0)::text                                     AS total_frequency,
         COALESCE(MAX(top_frequency), 0)::text                                       AS top_frequency,
         COALESCE(SUM(total_clicks), 0)::text                                        AS total_clicks,
         COALESCE(SUM(total_add_to_cart), 0)::text                                   AS total_add_to_cart,
         COALESCE(SUM(total_orders), 0)::text                                        AS total_orders,
         ROUND(AVG(query_count))::text                                               AS avg_query_count,
         COUNT(*)::text                                                              AS day_count
       FROM ${this.tableName("wb_product_jam_daily")}
       WHERE nm_id = $1
         AND jam_date BETWEEN $2::DATE AND $3::DATE`,
      [nmId, fromDate, toDate],
    );
    const r = result.rows[0];
    if (!r || Number(r.day_count) === 0) return null;
    return {
      avgPosition:    r.avg_position != null ? Number(r.avg_position) : null,
      bestPosition:   r.best_position != null ? Number(r.best_position) : null,
      totalFrequency: Number(r.total_frequency),
      topFrequency:   Number(r.top_frequency),
      totalClicks:    Number(r.total_clicks),
      totalAddToCart: Number(r.total_add_to_cart),
      totalOrders:    Number(r.total_orders),
      avgQueryCount:  Number(r.avg_query_count),
      dayCount:       Number(r.day_count),
    };
  }

  /** Today's (or latest available) JAM avg position per product. */
  async getLatestJamPositions(): Promise<{ nmId: number; avgPosition: number | null; bestPosition: number | null; jamDate: string }[]> {
    const result = await this.getPool().query<{
      nm_id: string;
      avg_position: string | null;
      best_position: string | null;
      jam_date: string;
    }>(
      `SELECT DISTINCT ON (nm_id)
         nm_id::text,
         avg_position::text,
         best_position::text,
         TO_CHAR(jam_date, 'YYYY-MM-DD') AS jam_date
       FROM ${this.tableName("wb_product_jam_daily")}
       ORDER BY nm_id ASC, jam_date DESC`,
    );
    return result.rows.map((r) => ({
      nmId:         Number(r.nm_id),
      avgPosition:  r.avg_position != null ? Number(r.avg_position) : null,
      bestPosition: r.best_position != null ? Number(r.best_position) : null,
      jamDate:      r.jam_date,
    }));
  }
}
