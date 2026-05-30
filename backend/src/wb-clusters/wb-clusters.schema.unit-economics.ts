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
 * применяемыми ко всем товарам: налог, эквайринг, ДРР (доля рекламных расходов). Каждая —
 * отдельная колонка `*_percent`; новая глобальная метрика = ещё одна колонка + строка
 * в GLOBAL_PERCENT_COLUMN репозитория (те же 2 знака после запятой). Налог по умолчанию
 * 12 % (DEFAULT 12 при ALTER бэкфилит существующую строку настроек).
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
    // Налог добавлен позже со ставкой по умолчанию 12 %. DEFAULT 12 при ADD COLUMN
    // бэкфилит существующую строку настроек (id = 1) → налог сразу 12 %, без отдельного
    // UPDATE. Пользователь может изменить/очистить значение в «Настройке».
    `
      ALTER TABLE ${tableName("wb_unit_economics_settings")}
        ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(7,2) NULL DEFAULT 12
    `,
    // На случай, если строки настроек ещё нет (никакая метрика не сохранялась): создаём
    // её, чтобы налог-по-умолчанию (12 %) применился и на чистой базе. Идемпотентно.
    `
      INSERT INTO ${tableName("wb_unit_economics_settings")} (id)
      VALUES (1)
      ON CONFLICT (id) DO NOTHING
    `,
  ];
}

/**
 * Ретроспектива маржи: дневной снапшот маржи на товар (₽ и %).
 *
 * wb_product_margin_daily_snapshot(nm_id, snapshot_date, ...) — одна строка на товар
 * на закрытый день. Маржа зависит от ТЕКУЩИХ настроек (комиссия/эквайринг/ДРР/налог),
 * с/с и эффективной цены, и по прошлым дням достоверно не восстанавливается (глобальные
 * %-метрики хранятся одной строкой без истории). Поэтому, как и «С/с продаж», серия НЕ
 * бэкфилится: ночной cron материализует только закрытый «вчера», ретроспектива стартует
 * с момента запуска и копится вперёд. «Сегодня» считается на лету в сервисе (та же формула).
 *
 * price_with_discount хранится рядом с маржой, чтобы «Итого, %» по столбцу-дате считался
 * взвешенно (Σмаржа₽ / Σцены × 100), как в inline-колонке «Маржа, %».
 */
export function getUnitEconomicsMarginSnapshotCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  const tbl = tableName("wb_product_margin_daily_snapshot");
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tbl} (
        nm_id               BIGINT        NOT NULL,
        snapshot_date       DATE          NOT NULL,
        price_with_discount NUMERIC(12,2) NOT NULL,
        margin_rub          NUMERIC(12,2) NOT NULL,
        margin_percent      NUMERIC(7,2)  NULL,
        updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, snapshot_date)
      )
    `,
  ];
}
