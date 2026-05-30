import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

/**
 * wb_product_acquiring_weekly — фактический эквайринг по товару за отчётную неделю WB.
 *
 * Источник: WB Statistics API /api/v5/supplier/reportDetailByPeriod (отчёт о реализации,
 * он же «финансовый отчёт»). Строки реализации агрегируются по nm_id × отчётной неделе
 * (week_start = date_from отчёта):
 *   acquiring_fee_sum = Σ acquiring_fee  — эквайринг в ₽ за неделю (net, с учётом возвратов),
 *   retail_amount_sum = Σ retail_amount  — база, к которой WB применил эквайринг.
 *
 * Средневзвешенный % эквайринга за неделю = acquiring_fee_sum / retail_amount_sum × 100
 * считается в unit-economics.service (фронт только рисует). Колонка юнит-экономики
 * берёт ПОСЛЕДНЮЮ закрытую неделю (MAX(week_start)); если по товару продаж за неделю нет —
 * fallback на ручной глобальный acquiring_percent из wb_unit_economics_settings.
 */
export function getProductAcquiringWeeklyCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_acquiring_weekly")} (
        nm_id              BIGINT      NOT NULL,
        week_start         DATE        NOT NULL,
        week_end           DATE        NOT NULL,
        acquiring_fee_sum  NUMERIC     NOT NULL DEFAULT 0,
        retail_amount_sum  NUMERIC     NOT NULL DEFAULT 0,
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, week_start)
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_acquiring_weekly_week_idx
        ON ${tableName("wb_product_acquiring_weekly")} (week_start DESC)
    `,
  ];
}
