import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

/**
 * Юнит-экономика: настройки комиссии по категориям + единый эквайринг.
 *
 * wb_unit_economics_category_commission — одна строка на родительскую категорию
 * (category_name из каталога), commission_percent в %. Применяется к каждому товару
 * этой категории при расчёте юнит-экономики (комиссия в ₽ = цена-со-скидкой × %).
 *
 * wb_unit_economics_settings — единственная строка (id = 1) с глобальными %-метриками,
 * применяемыми ко всем товарам: эквайринг, ДРР (доля рекламных расходов). Каждая —
 * отдельная колонка `*_percent`; новая глобальная метрика = ещё одна колонка + строка
 * в GLOBAL_PERCENT_COLUMNS сервиса (те же 2 знака после запятой).
 */
export function getUnitEconomicsSettingsCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_unit_economics_category_commission")} (
        category_name      TEXT          PRIMARY KEY,
        commission_percent NUMERIC(7,2)  NOT NULL,
        updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_unit_economics_settings")} (
        id                INT           PRIMARY KEY DEFAULT 1,
        acquiring_percent NUMERIC(7,2)  NULL,
        drr_percent       NUMERIC(7,2)  NULL,
        updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        CONSTRAINT wb_unit_economics_settings_single_row CHECK (id = 1)
      )
    `,
    // Колонка drr_percent добавлена позже — ALTER для уже созданных таблиц (идемпотентно).
    `
      ALTER TABLE ${tableName("wb_unit_economics_settings")}
        ADD COLUMN IF NOT EXISTS drr_percent NUMERIC(7,2) NULL
    `,
  ];
}
