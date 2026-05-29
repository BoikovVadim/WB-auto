import { WbClustersRepositoryReturns } from "./wb-clusters.repository.returns";

export type BuyoutSnapshotRow = {
  nmId: number;
  ordersCount: number;
  buyoutsCount: number;
};

/**
 * Buyout-percent daily snapshot repository.
 *
 * Single source of truth: wb_product_buyout_daily_snapshot(nm_id, snapshot_date, ...).
 * Materialized once per day from wb_product_daily_orders. Frontend reads with a single
 * SELECT — no aggregation at query time, so the «% выкупа» column renders instantly.
 */
export abstract class WbClustersRepositoryBuyoutSnapshot extends WbClustersRepositoryReturns {
  /**
   * Computes SUM(orders), SUM(buyouts) per product over the last `days` days ending
   * the day BEFORE yesterday (yesterday−1, Moscow) and upserts a snapshot row per
   * product for snapshot_date=yesterday. Логика: колонка за дату D = скользящий год,
   * заканчивая D−1 включительно — ровно то, что показывала живая колонка «сегодня»
   * на дату D. Снапшот за вчера (D=yesterday) поэтому считается по yesterday−1.
   * This represents the final, closed-day buyout-percent and never gets overwritten on
   * subsequent days. Idempotent: re-running the same day overwrites the row.
   */
  async materializeBuyoutSnapshotForYesterday(days: number): Promise<{
    rowsWritten: number;
    snapshotDate: string;
  }> {
    const windowDays = Math.max(1, Math.floor(days));
    const ordersTbl   = this.tableName("wb_product_daily_orders");
    const snapshotTbl = this.tableName("wb_product_buyout_daily_snapshot");

    const result = await this.getPool().query<{ snapshot_date: string; rows: string }>(
      `WITH yesterday AS (
         SELECT (NOW() AT TIME ZONE 'Europe/Moscow')::DATE - 1 AS d
       ),
       agg AS (
         SELECT nm_id,
                SUM(orders_count)::INT  AS orders_count,
                SUM(buyouts_count)::INT AS buyouts_count
         FROM ${ordersTbl}
         WHERE order_date BETWEEN (((SELECT d FROM yesterday) - 1) - ($1::INT - 1)) AND ((SELECT d FROM yesterday) - 1)
         GROUP BY nm_id
       ),
       upsert AS (
         INSERT INTO ${snapshotTbl}
           (nm_id, snapshot_date, window_days, orders_count, buyouts_count, percent, updated_at)
         SELECT a.nm_id,
                (SELECT d FROM yesterday),
                $1::INT,
                a.orders_count,
                a.buyouts_count,
                CASE WHEN a.orders_count > 0 AND a.buyouts_count > 0
                     THEN ROUND((a.buyouts_count::NUMERIC / a.orders_count) * 100, 3)
                     ELSE NULL
                END,
                NOW()
         FROM agg a
         ON CONFLICT (nm_id, snapshot_date) DO UPDATE SET
           window_days    = EXCLUDED.window_days,
           orders_count   = EXCLUDED.orders_count,
           buyouts_count  = EXCLUDED.buyouts_count,
           percent        = EXCLUDED.percent,
           updated_at     = NOW()
         RETURNING 1
       )
       SELECT TO_CHAR((SELECT d FROM yesterday), 'YYYY-MM-DD') AS snapshot_date,
              (SELECT COUNT(*)::TEXT FROM upsert)              AS rows`,
      [windowDays],
    );

    const row = result.rows[0];
    return {
      rowsWritten: row ? Number(row.rows) : 0,
      snapshotDate: row?.snapshot_date ?? "",
    };
  }

  /**
   * Returns the latest available snapshot row per product. Used by the inline
   * «% выкупа» column — one SELECT, no aggregation, instant render.
   */
  async getLatestBuyoutSnapshot(): Promise<BuyoutSnapshotRow[]> {
    const snapshotTbl = this.tableName("wb_product_buyout_daily_snapshot");
    const result = await this.getPool().query<{
      nm_id: string;
      orders_count: string;
      buyouts_count: string;
    }>(
      `SELECT DISTINCT ON (nm_id) nm_id::text,
             orders_count::text,
             buyouts_count::text
       FROM ${snapshotTbl}
       ORDER BY nm_id, snapshot_date DESC`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      ordersCount: Number(r.orders_count),
      buyoutsCount: Number(r.buyouts_count),
    }));
  }

  /**
   * Compact snapshot matrix for the «% выкупа» retrospective sheet.
   * Returns dates (descending) + per-product rows with rolling-365 % per day,
   * плюс счётчики orders/buyouts по тем же ячейкам. Counts нужны фронту, чтобы
   * считать «Итого» за день ВЗВЕШЕННО (Σвыкупов/Σзаказов) — так же, как считается
   * колонка «сегодня». Простое среднее процентов давало бы расхождение в ~2 %,
   * т.к. крупные товары с высоким выкупом весят в нём столько же, сколько мелкие.
   * Sparse: products without any snapshot row are omitted; missing days — null/0.
   *
   * Дата ячейки = snapshot_date как есть, без сдвига. Колонка за дату D содержит
   * скользящие 365 дней, заканчивая D−1 включительно (окно задаётся в materialize
   * ниже): «значение, актуальное на дату D = весь закрытый год по D−1». Так же
   * считается живая колонка «сегодня», поэтому снапшот за D — это просто
   * замороженное «сегодня» на дату D.
   */
  async getBuyoutSnapshotMatrix(): Promise<{
    dates: string[];
    products: {
      nmId: number;
      percents: (number | null)[];
      orders: number[];
      buyouts: number[];
    }[];
  }> {
    const snapshotTbl = this.tableName("wb_product_buyout_daily_snapshot");
    const result = await this.getPool().query<{
      nm_id: string;
      snapshot_date: string;
      percent: string | null;
      orders_count: string;
      buyouts_count: string;
    }>(
      `SELECT nm_id::text,
              TO_CHAR(snapshot_date, 'YYYY-MM-DD') AS snapshot_date,
              percent::text,
              orders_count::text,
              buyouts_count::text
       FROM ${snapshotTbl}
       ORDER BY snapshot_date DESC, nm_id ASC`,
    );
    if (result.rows.length === 0) return { dates: [], products: [] };

    const datesSet = new Set<string>();
    for (const r of result.rows) datesSet.add(r.snapshot_date);
    const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1));
    const dateIdx = new Map<string, number>();
    for (let i = 0; i < dates.length; i++) dateIdx.set(dates[i]!, i);

    type Row = { percents: (number | null)[]; orders: number[]; buyouts: number[] };
    const productMap = new Map<number, Row>();
    for (const r of result.rows) {
      const idx = dateIdx.get(r.snapshot_date);
      if (idx === undefined) continue;
      const nmId = Number(r.nm_id);
      let row = productMap.get(nmId);
      if (!row) {
        row = {
          percents: new Array<number | null>(dates.length).fill(null),
          orders: new Array<number>(dates.length).fill(0),
          buyouts: new Array<number>(dates.length).fill(0),
        };
        productMap.set(nmId, row);
      }
      // percent может быть NULL (нет заказов/выкупов) — Number(null) дал бы 0
      // и вернул бы фантомные «0,00 %», поэтому сохраняем null как null.
      row.percents[idx] = r.percent === null ? null : Number(r.percent);
      row.orders[idx] = Number(r.orders_count);
      row.buyouts[idx] = Number(r.buyouts_count);
    }
    const products = Array.from(productMap.entries()).map(([nmId, row]) => ({
      nmId,
      percents: row.percents,
      orders: row.orders,
      buyouts: row.buyouts,
    }));
    return { dates, products };
  }

  /** Snapshot history for one product (for the retrospective view). */
  async getBuyoutSnapshotHistory(nmId: number): Promise<{ date: string; orders: number; buyouts: number; percent: number }[]> {
    const result = await this.getPool().query<{
      d: string;
      orders_count: string;
      buyouts_count: string;
      percent: string;
    }>(
      `SELECT TO_CHAR(snapshot_date, 'YYYY-MM-DD') AS d,
              orders_count::text,
              buyouts_count::text,
              percent::text
       FROM ${this.tableName("wb_product_buyout_daily_snapshot")}
       WHERE nm_id = $1::BIGINT
       ORDER BY snapshot_date DESC`,
      [nmId],
    );
    return result.rows.map((r) => ({
      date: r.d,
      orders: Number(r.orders_count),
      buyouts: Number(r.buyouts_count),
      percent: Number(r.percent),
    }));
  }
}
