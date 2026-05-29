import { WbClustersRepositoryOrders } from "./wb-clusters.repository.orders";

export type DailyReturnsRow = {
  nmId: number;
  returnDate: string;   // "YYYY-MM-DD"
  returnsCount: number;
};

/**
 * Returns repository.
 *
 * wb_product_daily_returns(nm_id, return_date, returns_count).
 * Source: WB Statistics API /api/v1/supplier/sales rows with saleID starting with "R".
 *
 * Used together with wb_product_daily_orders to compute
 *   % выкупа = (orders − cancels − returns) / orders × 100.
 */
export abstract class WbClustersRepositoryReturns extends WbClustersRepositoryOrders {
  /** Upserts aggregated daily return counts. */
  async upsertDailyReturns(rows: DailyReturnsRow[]): Promise<void> {
    if (rows.length === 0) return;
    const tbl = this.tableName("wb_product_daily_returns");

    const COLS = 3;
    const values: unknown[] = [];
    const placeholders = rows.map((r, i) => {
      const b = i * COLS;
      values.push(r.nmId, r.returnDate, r.returnsCount);
      return `($${b+1}, $${b+2}, $${b+3}, NOW())`;
    });

    await this.getPool().query(
      `INSERT INTO ${tbl}
         (nm_id, return_date, returns_count, updated_at)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (nm_id, return_date) DO UPDATE SET
         returns_count = EXCLUDED.returns_count,
         updated_at    = NOW()`,
      values,
    );
  }

  /** Deletes return rows since fromDate (inclusive). Used for targeted re-sync. */
  async clearReturnsForDateRange(fromDateStr: string): Promise<void> {
    await this.getPool().query(
      `DELETE FROM ${this.tableName("wb_product_daily_returns")}
       WHERE return_date >= $1::DATE`,
      [fromDateStr],
    );
  }

  /**
   * Rolling-window aggregate: SUM(orders), SUM(cancels), SUM(returns) per product
   * over `days` days ending today (Moscow). Frontend computes
   *   % выкупа = (orders − cancels − returns) / orders × 100.
   */
  async getRollingBuyoutBreakdown(
    days: number,
  ): Promise<{
    nmId: number;
    ordersCount: number;
    cancelsCount: number;
    returnsCount: number;
  }[]> {
    const windowDays = Math.max(1, Math.floor(days));
    const ordersTbl  = this.tableName("wb_product_daily_orders");
    const returnsTbl = this.tableName("wb_product_daily_returns");

    const result = await this.getPool().query<{
      nm_id: string;
      orders_count: string;
      cancels_count: string;
      returns_count: string;
    }>(
      `WITH today AS (
         SELECT (NOW() AT TIME ZONE 'Europe/Moscow')::DATE AS d
       ),
       win AS (
         SELECT (SELECT d FROM today) - ($1::INT - 1) AS lo,
                (SELECT d FROM today)                  AS hi
       ),
       orders_agg AS (
         SELECT nm_id,
                SUM(orders_count)    AS orders_count,
                SUM(cancelled_count) AS cancels_count
         FROM ${ordersTbl}
         WHERE order_date BETWEEN (SELECT lo FROM win) AND (SELECT hi FROM win)
         GROUP BY nm_id
       ),
       returns_agg AS (
         SELECT nm_id,
                SUM(returns_count) AS returns_count
         FROM ${returnsTbl}
         WHERE return_date BETWEEN (SELECT lo FROM win) AND (SELECT hi FROM win)
         GROUP BY nm_id
       )
       SELECT o.nm_id::text,
              COALESCE(o.orders_count, 0)::text   AS orders_count,
              COALESCE(o.cancels_count, 0)::text  AS cancels_count,
              COALESCE(r.returns_count, 0)::text  AS returns_count
       FROM orders_agg o
       LEFT JOIN returns_agg r USING (nm_id)`,
      [windowDays],
    );

    return result.rows.map((row) => ({
      nmId: Number(row.nm_id),
      ordersCount: Number(row.orders_count),
      cancelsCount: Number(row.cancels_count),
      returnsCount: Number(row.returns_count),
    }));
  }
}
