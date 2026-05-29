import { WbClustersRepositorySppDaily } from "./wb-clusters.repository.spp-daily";

export type DailyStocksRow = {
  nmId: number;
  stockDate: string;   // "YYYY-MM-DD"
  quantity: number;
};

export abstract class WbClustersRepositoryStocks extends WbClustersRepositorySppDaily {
  /** Upserts daily stock snapshot (total quantity across all warehouses) per nmId. */
  async upsertDailyStocks(rows: DailyStocksRow[]): Promise<void> {
    if (rows.length === 0) return;
    const tbl = this.tableName("wb_product_daily_stocks");

    const values: unknown[] = [];
    const placeholders = rows.map((r, i) => {
      const b = i * 3;
      values.push(r.nmId, r.stockDate, r.quantity);
      return `($${b + 1}, $${b + 2}, $${b + 3}, NOW())`;
    });

    await this.getPool().query(
      `INSERT INTO ${tbl} (nm_id, stock_date, quantity, updated_at)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (nm_id, stock_date) DO UPDATE SET
         quantity   = EXCLUDED.quantity,
         updated_at = NOW()`,
      values,
    );
  }

  /** Returns the latest (most recent) stock quantity per nmId. */
  async getLatestStocks(): Promise<{ nmId: number; quantity: number }[]> {
    const result = await this.getPool().query<{ nm_id: string; quantity: string }>(
      `SELECT DISTINCT ON (nm_id) nm_id::text, quantity::text
       FROM ${this.tableName("wb_product_daily_stocks")}
       ORDER BY nm_id ASC, stock_date DESC`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      quantity: Number(r.quantity),
    }));
  }

  /** Returns all stock snapshots for all products and dates (newest first). */
  async getStocksMatrix(): Promise<{ nmId: number; stockDate: string; quantity: number }[]> {
    const result = await this.getPool().query<{ nm_id: string; stock_date: string; quantity: string }>(
      `SELECT nm_id::text, TO_CHAR(stock_date, 'YYYY-MM-DD') AS stock_date, quantity::text
       FROM ${this.tableName("wb_product_daily_stocks")}
       ORDER BY nm_id ASC, stock_date DESC`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      stockDate: r.stock_date,
      quantity: Number(r.quantity),
    }));
  }
}
