import { WbClustersRepositoryPrices } from "./wb-clusters.repository.prices";

/** Агрегированная строка эквайринга по товару за отчётную неделю. */
export type AcquiringWeeklyRow = {
  nmId: number;
  weekStart: string;   // "YYYY-MM-DD" — начало отчётной недели (date_from отчёта)
  weekEnd: string;     // "YYYY-MM-DD"
  acquiringFeeSum: number;   // Σ acquiring_fee, ₽
  retailAmountSum: number;   // Σ retail_amount, ₽ (база для %)
};

/** Эквайринг товара за последнюю закрытую неделю — суммы fee/retail (% считает сервис). */
export type LatestWeekAcquiring = {
  nmId: number;
  acquiringFeeSum: number;
  retailAmountSum: number;
};

/** Строка всей истории эквайринга по неделям (для матрицы-ретроспективы). */
export type AcquiringWeeklyHistoryRow = {
  nmId: number;
  weekStart: string;   // "YYYY-MM-DD"
  weekEnd: string;
  acquiringFeeSum: number;
  retailAmountSum: number;
};

/**
 * Acquiring repository.
 *
 * wb_product_acquiring_weekly(nm_id, week_start, week_end, acquiring_fee_sum, retail_amount_sum).
 * Источник: WB Statistics API /api/v5/supplier/reportDetailByPeriod (отчёт о реализации),
 * агрегированный по nm_id × отчётной неделе в AcquiringSyncService.
 *
 * Используется юнит-экономикой: фактический средневзвешенный % эквайринга по товару
 * = acquiring_fee_sum / retail_amount_sum × 100 (последняя закрытая неделя).
 */
export abstract class WbClustersRepositoryAcquiring extends WbClustersRepositoryPrices {
  /**
   * Перезаписывающий upsert недельного эквайринга (при конфликте — EXCLUDED). Чанки
   * синка выровнены по границам недель (Пн–Вс), поэтому неделя целиком попадает в один
   * чанк — накопление со стыков не нужно, простая перезапись идемпотентна. Почанковая
   * запись делает бэкфилл рестарт-устойчивым: завершённые чанки переживают перезапуск.
   */
  async upsertAcquiringWeekly(rows: AcquiringWeeklyRow[]): Promise<void> {
    if (rows.length === 0) return;
    const tbl = this.tableName("wb_product_acquiring_weekly");

    const COLS = 5;
    const values: unknown[] = [];
    const placeholders = rows.map((r, i) => {
      const b = i * COLS;
      values.push(r.nmId, r.weekStart, r.weekEnd, r.acquiringFeeSum, r.retailAmountSum);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, NOW())`;
    });

    await this.getPool().query(
      `INSERT INTO ${tbl}
         (nm_id, week_start, week_end, acquiring_fee_sum, retail_amount_sum, updated_at)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (nm_id, week_start) DO UPDATE SET
         week_end          = EXCLUDED.week_end,
         acquiring_fee_sum = EXCLUDED.acquiring_fee_sum,
         retail_amount_sum = EXCLUDED.retail_amount_sum,
         updated_at        = NOW()`,
      values,
    );
  }

  /** Удаляет недели с week_start в диапазоне [from, to] — чистка недели перед перезаписью. */
  async clearAcquiringRange(fromDate: string, toDate: string): Promise<void> {
    await this.getPool().query(
      `DELETE FROM ${this.tableName("wb_product_acquiring_weekly")}
       WHERE week_start BETWEEN $1::DATE AND $2::DATE`,
      [fromDate, toDate],
    );
  }

  /**
   * Эквайринг за ПОСЛЕДНЮЮ закрытую отчётную неделю (MAX(week_start) глобально) по каждому
   * nm_id, у которого есть строки в этой неделе. Возвращает суммы fee/retail — взвешенный %
   * считает unit-economics.service (Σfee/Σretail × 100). Товары без строк сюда не попадают
   * (на фронте по ним подставляется ручной глобальный %).
   */
  async getLatestWeekAcquiring(): Promise<LatestWeekAcquiring[]> {
    const tbl = this.tableName("wb_product_acquiring_weekly");
    const result = await this.getPool().query<{
      nm_id: string;
      acquiring_fee_sum: string;
      retail_amount_sum: string;
    }>(
      `SELECT nm_id::text,
              acquiring_fee_sum::text,
              retail_amount_sum::text
       FROM ${tbl}
       WHERE week_start = (SELECT MAX(week_start) FROM ${tbl})`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      acquiringFeeSum: Number(r.acquiring_fee_sum),
      retailAmountSum: Number(r.retail_amount_sum),
    }));
  }

  /** Вся история эквайринга по неделям (для матрицы-ретроспективы), по неделе и товару. */
  async getAcquiringWeeklyHistory(): Promise<AcquiringWeeklyHistoryRow[]> {
    const tbl = this.tableName("wb_product_acquiring_weekly");
    const result = await this.getPool().query<{
      nm_id: string;
      week_start: string;
      week_end: string;
      acquiring_fee_sum: string;
      retail_amount_sum: string;
    }>(
      `SELECT nm_id::text,
              week_start::text,
              week_end::text,
              acquiring_fee_sum::text,
              retail_amount_sum::text
       FROM ${tbl}
       ORDER BY week_start ASC, nm_id ASC`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      weekStart: r.week_start,
      weekEnd: r.week_end,
      acquiringFeeSum: Number(r.acquiring_fee_sum),
      retailAmountSum: Number(r.retail_amount_sum),
    }));
  }
}
