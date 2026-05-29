import { WbClustersRepositoryStocks } from "./wb-clusters.repository.stocks";

export type DailyPricesRow = {
  nmId: number;
  priceDate: string;  // "YYYY-MM-DD"
  price: number;      // full price in RUB
  discount: number;   // seller discount, %
};

export abstract class WbClustersRepositoryPrices extends WbClustersRepositoryStocks {
  /** Upserts daily price snapshot per nmId. */
  async upsertDailyPrices(rows: DailyPricesRow[]): Promise<void> {
    if (rows.length === 0) return;
    const tbl = this.tableName("wb_product_daily_prices");

    const values: unknown[] = [];
    const placeholders = rows.map((r, i) => {
      const b = i * 4;
      values.push(r.nmId, r.priceDate, r.price, r.discount);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, NOW())`;
    });

    await this.getPool().query(
      `INSERT INTO ${tbl} (nm_id, price_date, price, discount, updated_at)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (nm_id, price_date) DO UPDATE SET
         price      = EXCLUDED.price,
         discount   = EXCLUDED.discount,
         updated_at = NOW()`,
      values,
    );
  }

  /** Returns the latest (most recent) price per nmId. */
  async getLatestPrices(): Promise<{ nmId: number; price: number; discount: number }[]> {
    const result = await this.getPool().query<{ nm_id: string; price: string; discount: string }>(
      `SELECT DISTINCT ON (nm_id) nm_id::text, price::text, discount::text
       FROM ${this.tableName("wb_product_daily_prices")}
       ORDER BY nm_id ASC, price_date DESC`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      price: Number(r.price),
      discount: Number(r.discount),
    }));
  }

  /** Returns all price snapshots for all products and dates (newest first). */
  async getPricesMatrix(): Promise<{ nmId: number; priceDate: string; price: number; discount: number }[]> {
    const result = await this.getPool().query<{
      nm_id: string;
      price_date: string;
      price: string;
      discount: string;
    }>(
      `SELECT nm_id::text, TO_CHAR(price_date, 'YYYY-MM-DD') AS price_date, price::text, discount::text
       FROM ${this.tableName("wb_product_daily_prices")}
       ORDER BY nm_id ASC, price_date DESC`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      priceDate: r.price_date,
      price: Number(r.price),
      discount: Number(r.discount),
    }));
  }
}
