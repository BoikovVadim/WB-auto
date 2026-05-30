import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

/**
 * Юнит-экономика: настройки комиссии по предметам (subjectName) + единый эквайринг.
 *
 * wb_unit_economics_subject_commission — одна строка на предмет каталога
 * (subject_name из wb_product_catalog), commission_percent в %. WB берёт комиссию
 * именно по предмету, поэтому ключ — предмет, а не верхнеуровневая категория.
 * Применяется к каждому товару этого предмета при расчёте юнит-экономики
 * (комиссия в ₽ = цена-со-скидкой × %).
 *
 * wb_unit_economics_settings — единственная строка (id = 1) с глобальными %-метриками,
 * применяемыми ко всем товарам: эквайринг, ДРР (доля рекламных расходов). Каждая —
 * отдельная колонка `*_percent`; новая глобальная метрика = ещё одна колонка + строка
 * в GLOBAL_PERCENT_COLUMNS сервиса (те же 2 знака после запятой).
 */
export function getUnitEconomicsSettingsCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  const subjectTable = tableName("wb_unit_economics_subject_commission");
  const legacyCategoryTable = tableName("wb_unit_economics_category_commission");
  return [
    `
      CREATE TABLE IF NOT EXISTS ${subjectTable} (
        subject_name       TEXT          PRIMARY KEY,
        commission_percent NUMERIC(7,2)  NOT NULL,
        updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `,
    // Миграция с прежней «комиссии по категориям»: комиссия задаётся по предмету
    // (subjectName), а не по верхнеуровневой категории (parentName). Переносим
    // строки 1-в-1 по имени и удаляем старую таблицу. Идемпотентно и без потери
    // данных: если старой таблицы нет — блок ничего не делает.
    `
      DO $$
      BEGIN
        IF to_regclass('${legacyCategoryTable}') IS NOT NULL THEN
          INSERT INTO ${subjectTable} (subject_name, commission_percent, updated_at)
          SELECT category_name, commission_percent, updated_at
          FROM ${legacyCategoryTable}
          ON CONFLICT (subject_name) DO NOTHING;
          DROP TABLE ${legacyCategoryTable};
        END IF;
      END $$;
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
