import { WbClustersRepositoryBuyoutSnapshot } from "./wb-clusters.repository.buyout-snapshot";

/**
 * «С/с продаж» daily snapshot repository.
 *
 * Single source of truth: wb_product_cost_sum_daily_snapshot(nm_id, snapshot_date, ...).
 * «С/с продаж» за день = orders_count(день) × %выкупа(день) × себестоимость(на день) —
 * себестоимость тех заказов, что реально выкупят (зеркало «Выручки», только по
 * себестоимости вместо суммы заказов). %выкупа берём ровно тот же, что и «Выручка» —
 * замороженный rolling-365 из wb_product_buyout_daily_snapshot за ту же дату.
 *
 * Серия НЕ бэкфилится по истории (себестоимость по прошлым дням недостоверна):
 * cron материализует только закрытый «вчера», поэтому ретроспектива стартует с
 * момента запуска и копится вперёд. «Сегодня» считается на лету в сервисе.
 */
export abstract class WbClustersRepositoryCostSumSnapshot extends WbClustersRepositoryBuyoutSnapshot {
  /**
   * Считает «С/с продаж» за вчера (Москва) и апсертит строку на snapshot_date=yesterday.
   * orders_count — заказы за вчера; buyout_percent — снапшот % выкупа за вчера (его
   * пишет materializeBuyoutSnapshotForYesterday чуть раньше в ту же ночь); cost_value —
   * последняя себестоимость, действующая на вчера. Идемпотентно: повтор за тот же день
   * перезаписывает строку. Товары без заказов / без % выкупа / без себестоимости
   * пропускаются — как «нет данных» (в ретроспективе ячейка пустая).
   */
  async materializeCostSumSnapshotForYesterday(): Promise<{
    rowsWritten: number;
    snapshotDate: string;
  }> {
    const ordersTbl   = this.tableName("wb_product_daily_orders");
    const buyoutTbl   = this.tableName("wb_product_buyout_daily_snapshot");
    const costTbl     = this.tableName("wb_product_cost_price");
    const costSumTbl  = this.tableName("wb_product_cost_sum_daily_snapshot");

    const result = await this.getPool().query<{ snapshot_date: string; rows: string }>(
      `WITH yesterday AS (
         SELECT (NOW() AT TIME ZONE 'Europe/Moscow')::DATE - 1 AS d
       ),
       cost AS (
         SELECT DISTINCT ON (nm_id) nm_id, cost_value
         FROM ${costTbl}
         WHERE effective_date <= (SELECT d FROM yesterday)
         ORDER BY nm_id, effective_date DESC
       ),
       orders AS (
         SELECT nm_id, orders_count
         FROM ${ordersTbl}
         WHERE order_date = (SELECT d FROM yesterday)
           AND orders_count > 0
       ),
       upsert AS (
         INSERT INTO ${costSumTbl}
           (nm_id, snapshot_date, orders_count, buyout_percent, cost_value, cost_sum, updated_at)
         SELECT o.nm_id,
                (SELECT d FROM yesterday),
                o.orders_count,
                b.percent,
                c.cost_value,
                ROUND(o.orders_count * (b.percent / 100.0) * c.cost_value, 2),
                NOW()
         FROM orders o
         JOIN ${buyoutTbl} b
           ON b.nm_id = o.nm_id
          AND b.snapshot_date = (SELECT d FROM yesterday)
          AND b.percent IS NOT NULL
         JOIN cost c ON c.nm_id = o.nm_id
         ON CONFLICT (nm_id, snapshot_date) DO UPDATE SET
           orders_count   = EXCLUDED.orders_count,
           buyout_percent = EXCLUDED.buyout_percent,
           cost_value     = EXCLUDED.cost_value,
           cost_sum       = EXCLUDED.cost_sum,
           updated_at     = NOW()
         RETURNING 1
       )
       SELECT TO_CHAR((SELECT d FROM yesterday), 'YYYY-MM-DD') AS snapshot_date,
              (SELECT COUNT(*)::TEXT FROM upsert)              AS rows`,
    );

    const row = result.rows[0];
    return {
      rowsWritten: row ? Number(row.rows) : 0,
      snapshotDate: row?.snapshot_date ?? "",
    };
  }

  /**
   * Compact-матрица «С/с продаж» для ретроспективы: dates (DESC) + по товару vals[i]
   * = cost_sum за дату. Читается одним SELECT'ом, без агрегации. Sparse: товары без
   * единой строки опускаются, пропущенные дни — null. «Сегодня» в таблице нет (его
   * считает сервис на лету), поэтому колонки — только закрытые дни.
   */
  async getCostSumSnapshotMatrix(): Promise<{
    dates: string[];
    products: { nmId: number; vals: (number | null)[] }[];
  }> {
    const costSumTbl = this.tableName("wb_product_cost_sum_daily_snapshot");
    const result = await this.getPool().query<{
      nm_id: string;
      snapshot_date: string;
      cost_sum: string | null;
    }>(
      `SELECT nm_id::text,
              TO_CHAR(snapshot_date, 'YYYY-MM-DD') AS snapshot_date,
              cost_sum::text
       FROM ${costSumTbl}
       ORDER BY snapshot_date DESC, nm_id ASC`,
    );
    if (result.rows.length === 0) return { dates: [], products: [] };

    const datesSet = new Set<string>();
    for (const r of result.rows) datesSet.add(r.snapshot_date);
    const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1));
    const dateIdx = new Map<string, number>();
    for (let i = 0; i < dates.length; i++) dateIdx.set(dates[i]!, i);

    const productMap = new Map<number, (number | null)[]>();
    for (const r of result.rows) {
      const idx = dateIdx.get(r.snapshot_date);
      if (idx === undefined) continue;
      const nmId = Number(r.nm_id);
      let vals = productMap.get(nmId);
      if (!vals) {
        vals = new Array<number | null>(dates.length).fill(null);
        productMap.set(nmId, vals);
      }
      vals[idx] = r.cost_sum === null ? null : Number(r.cost_sum);
    }
    const products = Array.from(productMap.entries()).map(([nmId, vals]) => ({ nmId, vals }));
    return { dates, products };
  }
}
