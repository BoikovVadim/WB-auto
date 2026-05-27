import { WbClustersRepositoryRawDataRead } from "./wb-clusters.repository.raw-data-read";

export type CostPriceCurrentRow = {
  nm_id: string;
  cost_value: string;
  effective_date: string;
  updated_at: string;
};

export type CostPriceHistoryRow = {
  nm_id: string;
  cost_value: string;
  effective_date: string;
  updated_at: string;
};

export type CostPriceCurrent = {
  nmId: number;
  costValue: number;
  effectiveDate: string;
  updatedAt: string;
};

export type CostPriceHistoryEntry = {
  nmId: number;
  costValue: number;
  effectiveDate: string;
  updatedAt: string;
};

export abstract class WbClustersRepositoryCostPrice extends WbClustersRepositoryRawDataRead {
  /** Returns the latest cost price per product for all products that have one. */
  async getAllCurrentCostPrices(): Promise<CostPriceCurrent[]> {
    const pool = this.getPool();
    const result = await pool.query<CostPriceCurrentRow>(
      `
      SELECT DISTINCT ON (nm_id)
        nm_id::text AS nm_id,
        cost_value::text AS cost_value,
        TO_CHAR(effective_date, 'YYYY-MM-DD') AS effective_date,
        TO_CHAR(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
      FROM ${this.tableName("wb_product_cost_price")}
      ORDER BY nm_id, effective_date DESC
      `,
    );
    return result.rows.map((row) => ({
      nmId: Number(row.nm_id),
      costValue: Number(row.cost_value),
      effectiveDate: row.effective_date,
      updatedAt: row.updated_at,
    }));
  }

  /** Returns cost price history for a single product, newest first. */
  async getCostPriceHistory(nmId: number, limit = 100): Promise<CostPriceHistoryEntry[]> {
    const pool = this.getPool();
    const result = await pool.query<CostPriceHistoryRow>(
      `
      SELECT
        nm_id::text AS nm_id,
        cost_value::text AS cost_value,
        TO_CHAR(effective_date, 'YYYY-MM-DD') AS effective_date,
        TO_CHAR(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
      FROM ${this.tableName("wb_product_cost_price")}
      WHERE nm_id = $1
      ORDER BY effective_date DESC
      LIMIT $2
      `,
      [nmId, limit],
    );
    return result.rows.map((row) => ({
      nmId: Number(row.nm_id),
      costValue: Number(row.cost_value),
      effectiveDate: row.effective_date,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Returns all historical (nm_id, effective_date, cost_value) rows
   * for dates strictly before today, ordered nm_id ASC, effective_date DESC.
   * Today's values come from getAllCurrentCostPrices() and are shown separately
   * by the frontend — no duplication needed here.
   */
  async getAllCostPricesMatrix(): Promise<{ nmId: number; effectiveDate: string; costValue: number }[]> {
    const pool = this.getPool();
    const result = await pool.query<{ nm_id: string; effective_date: string; cost_value: string }>(
      `
      SELECT
        nm_id::text                           AS nm_id,
        TO_CHAR(effective_date, 'YYYY-MM-DD') AS effective_date,
        cost_value::text                      AS cost_value
      FROM ${this.tableName("wb_product_cost_price")}
      WHERE effective_date < CURRENT_DATE
      ORDER BY nm_id ASC, effective_date DESC
      `,
    );
    return result.rows.map((row) => ({
      nmId: Number(row.nm_id),
      effectiveDate: row.effective_date,
      costValue: Number(row.cost_value),
    }));
  }

  /**
   * Copies each product's most recent cost price into today's date row
   * (INSERT … ON CONFLICT DO NOTHING so existing today rows are untouched).
   * Used by the nightly snapshot cron.
   */
  async snapshotLatestCostPricesToToday(): Promise<number> {
    const pool = this.getPool();
    const result = await pool.query<{ count: string }>(
      `
      WITH latest AS (
        SELECT DISTINCT ON (nm_id) nm_id, cost_value
        FROM ${this.tableName("wb_product_cost_price")}
        WHERE effective_date < CURRENT_DATE
        ORDER BY nm_id, effective_date DESC
      )
      INSERT INTO ${this.tableName("wb_product_cost_price")} (nm_id, effective_date, cost_value, updated_at)
      SELECT nm_id, CURRENT_DATE, cost_value, NOW()
      FROM latest
      ON CONFLICT (nm_id, effective_date) DO NOTHING
      `,
    );
    return result.rowCount ?? 0;
  }

  /** Deletes today's cost price entry for a product (clears the value). */
  async deleteTodayCostPrice(nmId: number): Promise<void> {
    const pool = this.getPool();
    await pool.query(
      `DELETE FROM ${this.tableName("wb_product_cost_price")} WHERE nm_id = $1 AND effective_date = CURRENT_DATE`,
      [nmId],
    );
  }

  /** Upserts today's cost price for a product. */
  async upsertCostPrice(nmId: number, costValue: number): Promise<CostPriceCurrent> {
    const pool = this.getPool();
    const result = await pool.query<CostPriceCurrentRow>(
      `
      INSERT INTO ${this.tableName("wb_product_cost_price")} (nm_id, effective_date, cost_value, updated_at)
      VALUES ($1, CURRENT_DATE, $2, NOW())
      ON CONFLICT (nm_id, effective_date)
      DO UPDATE SET cost_value = EXCLUDED.cost_value, updated_at = NOW()
      RETURNING
        nm_id::text AS nm_id,
        cost_value::text AS cost_value,
        TO_CHAR(effective_date, 'YYYY-MM-DD') AS effective_date,
        TO_CHAR(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
      `,
      [nmId, costValue],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Upsert returned no row");
    return {
      nmId: Number(row.nm_id),
      costValue: Number(row.cost_value),
      effectiveDate: row.effective_date,
      updatedAt: row.updated_at,
    };
  }
}
