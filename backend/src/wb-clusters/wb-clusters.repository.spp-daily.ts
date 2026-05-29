import { WbClustersRepositoryCostSumSnapshot } from "./wb-clusters.repository.cost-sum-snapshot";

/**
 * «СПП» (средняя скидка постоянного покупателя) daily repository.
 *
 * Single source of truth: wb_product_spp_daily(nm_id, spp_date, spp_avg, orders_count).
 * spp приходит на каждый заказ только из Statistics API (/api/v1/supplier/orders).
 * spp_avg = AVG(spp) по всем заказам товара за день. «Сегодня» освежает 6-часовой
 * cron, закрытый день добивается ночью; история — разовым backfill за неделю. Паттерн
 * зеркалит «Заказы» (одна daily-таблица), а не «снапшот с момента запуска».
 */
export abstract class WbClustersRepositorySppDaily extends WbClustersRepositoryCostSumSnapshot {
  /**
   * Апсертит среднюю СПП за конкретный московский день. Идемпотентно: повтор за тот
   * же день перезаписывает строки (ON CONFLICT DO UPDATE). fetchOrdersForDay всегда
   * отдаёт полный день, поэтому удалять «исчезнувшие» товары не нужно.
   */
  async upsertSppDaily(
    moscowDateStr: string,
    aggregates: { nmId: number; sppAvg: number; ordersCount: number }[],
  ): Promise<number> {
    if (aggregates.length === 0) return 0;
    const tbl = this.tableName("wb_product_spp_daily");

    const COLS = 3;
    const values: unknown[] = [moscowDateStr];
    const placeholders = aggregates.map((a, i) => {
      const b = 1 + i * COLS;
      values.push(a.nmId, a.sppAvg, a.ordersCount);
      return `($${b + 1}, $1::DATE, $${b + 2}, $${b + 3}, NOW())`;
    });

    const result = await this.getPool().query(
      `INSERT INTO ${tbl}
         (nm_id, spp_date, spp_avg, orders_count, updated_at)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (nm_id, spp_date) DO UPDATE SET
         spp_avg      = EXCLUDED.spp_avg,
         orders_count = EXCLUDED.orders_count,
         updated_at   = NOW()`,
      values,
    );
    return result.rowCount ?? 0;
  }

  /** Средняя СПП за сегодня (Москва) по товарам — для ячейки колонки и pinned-колонки листа. */
  async getSppToday(): Promise<{ nmId: number; spp: number }[]> {
    const result = await this.getPool().query<{ nm_id: string; spp_avg: string | null }>(
      `SELECT nm_id::text, spp_avg::text
       FROM ${this.tableName("wb_product_spp_daily")}
       WHERE spp_date = (NOW() AT TIME ZONE 'Europe/Moscow')::DATE
         AND spp_avg IS NOT NULL`,
    );
    return result.rows
      .filter((r) => r.spp_avg !== null)
      .map((r) => ({ nmId: Number(r.nm_id), spp: Number(r.spp_avg) }));
  }

  /**
   * Compact-матрица СПП для ретроспективы: dates (DESC) + по товару vals[i] = spp_avg
   * за дату. Один SELECT без агрегации (зеркало getCostSumSnapshotMatrix). «Сегодня»
   * исключаем — он pinned-колонка (live из getSppToday), как «Сегодня» у заказов.
   */
  async getSppDailyMatrix(): Promise<{
    dates: string[];
    products: { nmId: number; vals: (number | null)[] }[];
  }> {
    const tbl = this.tableName("wb_product_spp_daily");
    const result = await this.getPool().query<{
      nm_id: string;
      spp_date: string;
      spp_avg: string | null;
    }>(
      // Без ORDER BY: даты сортируются ниже в JS, строки ключуются по nmId.
      `SELECT nm_id::text,
              TO_CHAR(spp_date, 'YYYY-MM-DD') AS spp_date,
              spp_avg::text
       FROM ${tbl}
       WHERE spp_date < (NOW() AT TIME ZONE 'Europe/Moscow')::DATE`,
    );
    if (result.rows.length === 0) return { dates: [], products: [] };

    const datesSet = new Set<string>();
    for (const r of result.rows) datesSet.add(r.spp_date);
    const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1));
    const dateIdx = new Map<string, number>();
    for (let i = 0; i < dates.length; i++) dateIdx.set(dates[i]!, i);

    const productMap = new Map<number, (number | null)[]>();
    for (const r of result.rows) {
      const idx = dateIdx.get(r.spp_date);
      if (idx === undefined) continue;
      const nmId = Number(r.nm_id);
      let vals = productMap.get(nmId);
      if (!vals) {
        vals = new Array<number | null>(dates.length).fill(null);
        productMap.set(nmId, vals);
      }
      vals[idx] = r.spp_avg === null ? null : Number(r.spp_avg);
    }
    const products = Array.from(productMap.entries()).map(([nmId, vals]) => ({ nmId, vals }));
    return { dates, products };
  }
}
