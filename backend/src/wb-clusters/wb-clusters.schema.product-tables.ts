import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

/**
 * Create-инструкции (и парные им идемпотентные ALTER) для per-product дневных
 * снапшотов и журналов изменений. Вынесено из wb-clusters.schema.alter-backfill,
 * который держал только catalog/cluster alter+backfill+миграции ключей. Чистые
 * функции (context → string[]), агрегируются в wb-clusters.schema.ts.
 */
export function getCostPriceCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_cost_price")} (
        nm_id BIGINT NOT NULL,
        effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
        cost_value NUMERIC NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, effective_date)
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_cost_price_nm_id_idx
        ON ${tableName("wb_product_cost_price")} (nm_id, effective_date DESC)
    `,
  ];
}

export function getChangeLogCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_change_log")} (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        nm_id BIGINT NOT NULL,
        advert_id BIGINT NOT NULL,
        cluster_name TEXT NOT NULL,
        change_type TEXT NOT NULL,
        old_value TEXT NULL,
        new_value TEXT NOT NULL,
        job_id TEXT NULL,
        initiated_by TEXT NULL,
        reason TEXT NULL,
        position INTEGER NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    // initiated_by: кто инициировал изменение — 'user' (вручную через UI) либо
    // 'automation' (движок автоматизации, крон каждые 10 мин). ALTER нужен
    // для уже существующих таблиц на проде; старые записи остаются NULL → фронт
    // показывает «—».
    `
      ALTER TABLE ${tableName("wb_cluster_change_log")}
      ADD COLUMN IF NOT EXISTS initiated_by TEXT NULL
    `,
    // reason/position: «почему» движок сменил ставку (up/down/at_cap/at_min) и при какой
    // замеренной позиции в выдаче — чтобы История показывала «ставка X→Y, потому что место P».
    // Только для авто-смен ставок; у ручных и старых записей NULL → фронт показывает «—».
    `
      ALTER TABLE ${tableName("wb_cluster_change_log")}
      ADD COLUMN IF NOT EXISTS reason TEXT NULL
    `,
    `
      ALTER TABLE ${tableName("wb_cluster_change_log")}
      ADD COLUMN IF NOT EXISTS position INTEGER NULL
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_change_log_campaign_idx
        ON ${tableName("wb_cluster_change_log")} (nm_id, advert_id, applied_at DESC)
    `,
  ];
}

/** Daily orders aggregated per product from WB Statistics API */
/**
 * wb_product_daily_orders: aggregated order counts per nm_id per day.
 * Data source: WB Analytics CSV report (DETAIL_HISTORY_REPORT).
 * One download → ZIP → parse → INSERT. No per-product batching.
 * Frontend reads with: SELECT nm_id, order_date, orders_count FROM wb_product_daily_orders
 */
export function getProductDailyOrdersCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_daily_orders")} (
        nm_id           BIGINT      NOT NULL,
        order_date      DATE        NOT NULL,
        orders_count    INT         NOT NULL DEFAULT 0,
        cancelled_count INT         NOT NULL DEFAULT 0,
        orders_sum      NUMERIC     NOT NULL DEFAULT 0,
        buyouts_count   INT         NOT NULL DEFAULT 0,
        buyouts_sum     NUMERIC     NOT NULL DEFAULT 0,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, order_date)
      )
    `,
    `
      ALTER TABLE ${tableName("wb_product_daily_orders")}
        ADD COLUMN IF NOT EXISTS buyouts_count INT NOT NULL DEFAULT 0
    `,
    `
      ALTER TABLE ${tableName("wb_product_daily_orders")}
        ADD COLUMN IF NOT EXISTS buyouts_sum NUMERIC NOT NULL DEFAULT 0
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_daily_orders_date_idx
        ON ${tableName("wb_product_daily_orders")} (order_date DESC)
    `,
    // Покрывающий индекс под матричные выборки (nm_id × order_date): позволяет
    // index-only scan без обращения к heap для getOrdersMatrix / getOrdersSumMatrix /
    // getBuyoutMatrix. INCLUDE держит все читаемые матрицами поля. Дешёвая страховка
    // на рост истории (таблица растёт ~447 товаров/день).
    `
      CREATE INDEX IF NOT EXISTS wb_product_daily_orders_nm_date_desc_idx
        ON ${tableName("wb_product_daily_orders")} (nm_id ASC, order_date DESC)
        INCLUDE (orders_count, orders_sum, buyouts_count)
    `,
  ];
}

/** General-purpose system change log covering all entity types (cost_price, cluster_bid, etc.) */
export function getSystemChangeLogCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_system_change_log")} (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        entity_type TEXT NOT NULL,
        nm_id BIGINT NULL,
        entity_label TEXT NULL,
        change_type TEXT NOT NULL,
        old_value TEXT NULL,
        new_value TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_system_change_log_created_idx
        ON ${tableName("wb_system_change_log")} (created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_system_change_log_nm_id_idx
        ON ${tableName("wb_system_change_log")} (nm_id, created_at DESC)
    `,
  ];
}

/**
 * wb_product_daily_returns: counts of физических возвратов (товар возвращён клиентом)
 * per product per day. Source: WB Statistics API /api/v1/supplier/sales,
 * rows with saleID starting with "R". Used by the products % выкупа column:
 *   % выкупа = (orders − cancels − returns) / orders × 100.
 */
export function getProductDailyReturnsCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_daily_returns")} (
        nm_id          BIGINT      NOT NULL,
        return_date    DATE        NOT NULL,
        returns_count  INT         NOT NULL DEFAULT 0,
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, return_date)
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_daily_returns_date_idx
        ON ${tableName("wb_product_daily_returns")} (return_date DESC)
    `,
  ];
}

/**
 * wb_product_buyout_daily_snapshot: ежедневный снапшот % выкупа по плавающему
 * окну 365 дней. Заполняется cron-ом раз в сутки после полной перезаливки
 * заказов. Колонка % выкупа в карточке товаров читает строку за самую свежую
 * snapshot_date одним SELECT'ом — без агрегации на лету. Параллельно копится
 * полная история «как менялся % выкупа по дням».
 */
export function getProductBuyoutDailySnapshotCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_buyout_daily_snapshot")} (
        nm_id          BIGINT      NOT NULL,
        snapshot_date  DATE        NOT NULL,
        window_days    INT         NOT NULL DEFAULT 365,
        orders_count   INT         NOT NULL DEFAULT 0,
        buyouts_count  INT         NOT NULL DEFAULT 0,
        percent        NUMERIC(6,3) NOT NULL DEFAULT 0,
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, snapshot_date)
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_buyout_daily_snapshot_date_idx
        ON ${tableName("wb_product_buyout_daily_snapshot")} (snapshot_date DESC)
    `,
  ];
}

/**
 * wb_product_buyout_daily_snapshot: снимаем NOT NULL/DEFAULT с percent и
 * пробэкфиливаем уже записанные нули в NULL. Логика: процент выкупа имеет смысл
 * только когда есть и заказы, и выкупы. Нулевые ячейки (нет заказов в окне или
 * выкупы ещё не подтянулись из-за лага WB) — это «нет данных», а не «0 % выкупа»,
 * и они не должны попадать в «Итого» (простое среднее по непустым ячейкам).
 */
export function getProductBuyoutDailySnapshotAlterStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      ALTER TABLE ${tableName("wb_product_buyout_daily_snapshot")}
      ALTER COLUMN percent DROP NOT NULL
    `,
    `
      ALTER TABLE ${tableName("wb_product_buyout_daily_snapshot")}
      ALTER COLUMN percent DROP DEFAULT
    `,
    `
      UPDATE ${tableName("wb_product_buyout_daily_snapshot")}
      SET percent = NULL
      WHERE percent IS NOT NULL
        AND (orders_count = 0 OR buyouts_count = 0)
    `,
  ];
}

/**
 * wb_product_cost_sum_daily_snapshot: ежедневный снапшот «С/с продаж» (себестоимость
 * выкупленных заказов) = orders_count(день) × %выкупа(день) × себестоимость(на день).
 * Заполняется cron-ом раз в сутки ПОСЛЕ снапшота % выкупа (тот же %, что использует
 * «Выручка»). Серия начинается с момента запуска и копится вперёд — backfill истории
 * НЕ делаем (намеренно: себестоимость по прошлым дням недостоверна). Ретроспектива
 * читает строки одним SELECT'ом, «сегодня» считается на лету в сервисе.
 */
export function getProductCostSumDailySnapshotCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_cost_sum_daily_snapshot")} (
        nm_id          BIGINT       NOT NULL,
        snapshot_date  DATE         NOT NULL,
        orders_count   INT          NOT NULL DEFAULT 0,
        buyout_percent NUMERIC(6,3),
        cost_value     NUMERIC(14,2),
        cost_sum       NUMERIC(16,2),
        updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, snapshot_date)
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_cost_sum_daily_snapshot_date_idx
        ON ${tableName("wb_product_cost_sum_daily_snapshot")} (snapshot_date DESC)
    `,
  ];
}

/**
 * wb_product_spp_daily: ежедневная средняя СПП (скидка постоянного покупателя) по
 * заказам товара. spp приходит на каждый заказ только из Statistics API
 * (/api/v1/supplier/orders). spp_avg = AVG(spp) по всем заказам товара за день,
 * orders_count — число этих заказов. «Сегодня» обновляет 6-часовой cron, закрытый
 * день финализируется ночью; разовый backfill за неделю. Ретроспектива читает строки
 * одним SELECT'ом, «сегодня» (последняя дата) — pinned-колонка, как у «Заказов».
 */
export function getProductSppDailyCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_spp_daily")} (
        nm_id        BIGINT      NOT NULL,
        spp_date     DATE        NOT NULL,
        spp_avg      NUMERIC(6,3),
        orders_count INT         NOT NULL DEFAULT 0,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, spp_date)
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_spp_daily_date_idx
        ON ${tableName("wb_product_spp_daily")} (spp_date DESC)
    `,
  ];
}

/** wb_product_daily_stocks: daily stock snapshot per product (total quantity across all warehouses). */
export function getProductDailyStocksCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_daily_stocks")} (
        nm_id      BIGINT      NOT NULL,
        stock_date DATE        NOT NULL,
        quantity   INT         NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, stock_date)
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_daily_stocks_date_idx
        ON ${tableName("wb_product_daily_stocks")} (stock_date DESC)
    `,
  ];
}

export function getMonthlyFrequencyAlterStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      ALTER TABLE ${tableName("wb_search_query_frequencies")}
      ADD COLUMN IF NOT EXISTS subject_name TEXT NULL
    `,
    `
      ALTER TABLE ${tableName("wb_search_query_frequencies")}
      ADD COLUMN IF NOT EXISTS normalized_query_identity TEXT NULL
    `,
    `
      UPDATE ${tableName("wb_search_query_frequencies")}
      SET normalized_query_identity = normalized_query_text
      WHERE normalized_query_identity IS NULL
    `,
    `
      ALTER TABLE ${tableName("wb_search_query_frequencies")}
      ALTER COLUMN normalized_query_identity SET NOT NULL
    `,
    `
      ALTER TABLE ${tableName("wb_search_query_frequencies")}
      ADD COLUMN IF NOT EXISTS normalized_query_stem TEXT NULL
    `,
    `
      UPDATE ${tableName("wb_search_query_frequencies")}
      SET normalized_query_stem = TRIM(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            COALESCE(normalized_query_identity, normalized_query_text),
            '(иями|ями|ами|ого|ему|ому|ыми|ими|его|ая|яя|ое|ее|ой|ий|ый|ые|ие|их|ых|ую|юю|ам|ям|ах|ях|ом|ем|ов|ев|ей|а|я|ы|и|у|ю|о|е|ь|й)\\y',
            '',
            'gi'
          ),
          '\\s+',
          ' ',
          'g'
        )
      )
      WHERE normalized_query_stem IS NULL
    `,
    `
      ALTER TABLE ${tableName("wb_search_query_frequencies")}
      ALTER COLUMN normalized_query_stem SET NOT NULL
    `,
    // Cabinet queries previously matched frequency on normalized_query_text (which
    // keeps punctuation) and so almost never matched the report. Add a
    // punctuation-stripped identity column that mirrors
    // wb_search_query_frequencies.normalized_query_identity. New rows populate it on
    // import; existing rows are backfilled off the hot path by the monthly frequency
    // import job (see backfillCabinetQueryIdentity) — NOT here, because this migration
    // runs lazily on first repository use and an 8M-row rewrite must not block a request.
    `
      ALTER TABLE ${tableName("wb_cabinet_cluster_queries")}
      ADD COLUMN IF NOT EXISTS normalized_query_identity TEXT NULL
    `,
  ];
}

/** wb_product_daily_prices: daily price snapshot per product (price with seller discount). */
export function getProductDailyPricesCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_daily_prices")} (
        nm_id      BIGINT      NOT NULL,
        price_date DATE        NOT NULL,
        price      INT         NOT NULL DEFAULT 0,
        discount   INT         NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, price_date)
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_daily_prices_date_idx
        ON ${tableName("wb_product_daily_prices")} (price_date DESC)
    `,
  ];
}

/**
 * Очередь изменений цен, инициированных пользователем (запись на маркетплейс WB).
 * Одна строка на товар = последнее запрошенное изменение и его статус синка.
 * Заполняется ТОЛЬКО явным действием пользователя (PUT .../price) — ни один
 * крон/синк сюда не пишет, поэтому фоновые задачи не могут изменить цену на WB.
 */
export function getProductPriceChangesCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_price_changes")} (
        nm_id              BIGINT      PRIMARY KEY,
        desired_base_price INT         NOT NULL,
        desired_discount   INT         NOT NULL,
        desired_final      NUMERIC(12,2) NOT NULL,
        sync_status        TEXT        NOT NULL DEFAULT 'queued',
        upload_id          BIGINT,
        observed_final     NUMERIC(12,2),
        confirmed_at       TIMESTAMPTZ,
        retry_at           TIMESTAMPTZ,
        last_error         TEXT,
        attempt_count      INT         NOT NULL DEFAULT 0,
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    // observed_final добавлена позже — ALTER для уже созданных таблиц (идемпотентно).
    `
      ALTER TABLE ${tableName("wb_product_price_changes")}
        ADD COLUMN IF NOT EXISTS observed_final NUMERIC(12,2)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_price_changes_status_idx
        ON ${tableName("wb_product_price_changes")} (sync_status)
    `,
  ];
}
