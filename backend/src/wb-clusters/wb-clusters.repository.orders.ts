import { WbClustersRepositoryChangeLog } from "./wb-clusters.repository.change-log";

export type DailyOrdersRow = {
  nmId: number;
  orderDate: string;   // "YYYY-MM-DD"
  ordersCount: number;
  cancelledCount: number;
  ordersSum: number;
};

/**
 * Orders repository.
 *
 * Single source of truth: wb_product_daily_orders(nm_id, order_date, orders_count).
 * Data comes from WB Analytics CSV report (DETAIL_HISTORY_REPORT).
 * Frontend reads with simple SELECT — no aggregation, no raw rows, no cursors.
 */
export abstract class WbClustersRepositoryOrders extends WbClustersRepositoryChangeLog {
  /** Deletes order rows for a single calendar day. Used for targeted re-sync. */
  async clearOrdersForDay(moscowDateStr: string): Promise<void> {
    await this.getPool().query(
      `DELETE FROM ${this.tableName("wb_product_daily_orders")} WHERE order_date = $1::DATE`,
      [moscowDateStr],
    );
  }

  /** Deletes order rows since fromDate (inclusive). Accepts a "YYYY-MM-DD" Moscow date string. */
  async clearOrdersForDateRange(fromDateStr: string): Promise<void> {
    await this.getPool().query(
      `DELETE FROM ${this.tableName("wb_product_daily_orders")} WHERE order_date >= $1::DATE`,
      [fromDateStr],
    );
  }

  /** Upserts aggregated daily order counts from CSV report rows. */
  async upsertDailyOrders(rows: DailyOrdersRow[]): Promise<void> {
    if (rows.length === 0) return;
    const tbl = this.tableName("wb_product_daily_orders");

    const values: unknown[] = [];
    const placeholders = rows.map((r, i) => {
      const b = i * 5;
      values.push(r.nmId, r.orderDate, r.ordersCount, r.cancelledCount, r.ordersSum);
      return `($${b+1}, $${b+2}, $${b+3}, $${b+4}, $${b+5}, NOW())`;
    });

    await this.getPool().query(
      `INSERT INTO ${tbl} (nm_id, order_date, orders_count, cancelled_count, orders_sum, updated_at)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (nm_id, order_date) DO UPDATE SET
         orders_count    = EXCLUDED.orders_count,
         cancelled_count = EXCLUDED.cancelled_count,
         orders_sum      = EXCLUDED.orders_sum,
         updated_at      = NOW()`,
      values,
    );
  }

  /** Returns today's order counts per product. Equivalent to VLOOKUP by nmId on today's date. */
  async getTodayOrderCounts(): Promise<{ nmId: number; ordersCount: number; cancelledCount: number }[]> {
    const result = await this.getPool().query<{ nm_id: string; orders_count: string; cancelled_count: string }>(
      `SELECT nm_id::text, orders_count::text, cancelled_count::text
       FROM ${this.tableName("wb_product_daily_orders")}
       WHERE order_date = (NOW() AT TIME ZONE 'Europe/Moscow')::DATE`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      ordersCount: Number(r.orders_count),
      cancelledCount: Number(r.cancelled_count),
    }));
  }

  /** Returns all order counts (all dates, all products) for the retrospective matrix. */
  async getOrdersMatrix(): Promise<{ nmId: number; orderDate: string; ordersCount: number }[]> {
    const result = await this.getPool().query<{ nm_id: string; order_date: string; orders_count: string }>(
      `SELECT nm_id::text, TO_CHAR(order_date, 'YYYY-MM-DD') AS order_date, orders_count::text
       FROM ${this.tableName("wb_product_daily_orders")}
       ORDER BY nm_id ASC, order_date DESC`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      orderDate: r.order_date,
      ordersCount: Number(r.orders_count),
    }));
  }
}
