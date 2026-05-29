import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

export function getCatalogAlterStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      ALTER TABLE ${tableName("wb_product_catalog")}
      ADD COLUMN IF NOT EXISTS source_export_request_id TEXT NULL
    `,
    `
      ALTER TABLE ${tableName("wb_product_catalog")}
      ADD COLUMN IF NOT EXISTS category_name TEXT NULL
    `,
    `
      ALTER TABLE ${tableName("wb_product_catalog")}
      ADD COLUMN IF NOT EXISTS subject_id BIGINT NULL
    `,
    `
      ALTER TABLE ${tableName("wb_product_catalog")}
      ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ NULL
    `,
    `
      ALTER TABLE ${tableName("wb_product_catalog")}
      ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NULL
    `,
    `
      ALTER TABLE ${tableName("wb_product_catalog")}
      ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `,
  ];
}

export function getSyncRunAlterStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      ALTER TABLE ${tableName("wb_cluster_sync_runs")}
      ADD COLUMN IF NOT EXISTS warning_count INTEGER NOT NULL DEFAULT 0
    `,
    `
      ALTER TABLE ${tableName("wb_cluster_sync_runs")}
      ADD COLUMN IF NOT EXISTS has_partial_failure BOOLEAN NOT NULL DEFAULT FALSE
    `,
  ];
}

export function getCampaignAlterStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      ALTER TABLE ${tableName("wb_campaigns")}
      ADD COLUMN IF NOT EXISTS placements_search BOOLEAN NULL
    `,
    `
      ALTER TABLE ${tableName("wb_campaigns")}
      ADD COLUMN IF NOT EXISTS placements_recommendations BOOLEAN NULL
    `,
  ];
}

export function getCampaignProductAlterStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      ALTER TABLE ${tableName("wb_campaign_products")}
      ADD COLUMN IF NOT EXISTS search_bid NUMERIC NULL
    `,
    `
      ALTER TABLE ${tableName("wb_campaign_products")}
      ADD COLUMN IF NOT EXISTS search_bid_synced_at TIMESTAMPTZ NULL
    `,
    `
      ALTER TABLE ${tableName("wb_campaign_products")}
      ADD COLUMN IF NOT EXISTS min_search_bid NUMERIC NULL
    `,
    `
      ALTER TABLE ${tableName("wb_campaign_products")}
      ADD COLUMN IF NOT EXISTS min_search_bid_synced_at TIMESTAMPTZ NULL
    `,
  ];
}

export function getClusterStatsAlterStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      ALTER TABLE ${tableName("wb_cluster_stats")}
      ADD COLUMN IF NOT EXISTS shks NUMERIC NULL
    `,
  ];
}

export function getClusterWriteAlterStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      ALTER TABLE ${tableName("wb_cluster_bids")}
      ADD COLUMN IF NOT EXISTS bid_sync_status TEXT NULL
    `,
    `
      ALTER TABLE ${tableName("wb_cluster_bids")}
      ADD COLUMN IF NOT EXISTS bid_confirmed_at TIMESTAMPTZ NULL
    `,
    `
      ALTER TABLE ${tableName("wb_cluster_bids")}
      ADD COLUMN IF NOT EXISTS bid_retry_at TIMESTAMPTZ NULL
    `,
    `
      ALTER TABLE ${tableName("wb_cluster_bids")}
      ADD COLUMN IF NOT EXISTS bid_last_error TEXT NULL
    `,
    `
      ALTER TABLE ${tableName("wb_cluster_actions")}
      ADD COLUMN IF NOT EXISTS action_sync_status TEXT NULL
    `,
    `
      ALTER TABLE ${tableName("wb_cluster_actions")}
      ADD COLUMN IF NOT EXISTS action_retry_at TIMESTAMPTZ NULL
    `,
    `
      ALTER TABLE ${tableName("wb_cluster_actions")}
      ADD COLUMN IF NOT EXISTS action_last_error TEXT NULL
    `,
    `
      ALTER TABLE ${tableName("wb_cluster_bid_jobs")}
      ADD COLUMN IF NOT EXISTS processing_phase TEXT NOT NULL DEFAULT 'write'
    `,
  ];
}

export function getClusterWriteBackfillStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      UPDATE ${tableName("wb_cluster_bids")}
      SET
        bid_sync_status = 'confirmed',
        bid_confirmed_at = COALESCE(bid_confirmed_at, synced_at)
      WHERE bid_sync_status IS NULL
    `,
    `
      UPDATE ${tableName("wb_cluster_actions")}
      SET action_sync_status = 'confirmed'
      WHERE action_sync_status IS NULL
    `,
  ];
}

/**
 * Migrates cluster_key format for active/excluded clusters to include advertId.
 * Old format: "{nmId}:{sourceKind}:{normalizedName}"
 * New format: "{nmId}:{advertId}:{sourceKind}:{normalizedName}"
 *
 * Clusters without advert_id (orphaned) and the old-format active/excluded entries
 * are deleted here. They will be re-populated by the next sync cycle (≤10 min).
 * Stats clusters are product-scoped and retain their old format — no change needed.
 */
export function getClusterKeyMigrationStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    // Delete old active/excluded clusters whose cluster_key does NOT include advertId.
    // Old keys look like "{nmId}:active:{name}" or "{nmId}:excluded:{name}",
    // new keys look like "{nmId}:{advertId}:active:{name}".
    // A reliable heuristic: old keys start with "{nmId}:active:" or "{nmId}:excluded:".
    `
      DELETE FROM ${tableName("wb_clusters")}
      WHERE source_kind IN ('active', 'excluded')
        AND (
          cluster_key ~ '^[0-9]+:active:'
          OR cluster_key ~ '^[0-9]+:excluded:'
        )
    `,
    // Rebuild cluster_key to use the punctuation-preserving normalizer (normalizeQuery),
    // matching the normalized_cluster_name column. The old key used the punctuation-
    // stripping normalizeAdvertisingIdentity, so punctuation-only-different names collided
    // and one silently overwrote the other.
    //
    // Migrating the PK requires three idempotent steps (validated against prod via a
    // BEGIN/ROLLBACK dry run before shipping):
    //   1. wb_cluster_stats FK -> ON UPDATE CASCADE, so a parent rekey carries its
    //      stats children along (the FK previously had no ON UPDATE action and blocked
    //      key updates entirely, which crashed an earlier attempt).
    //   2. Dedup: rows that recompute to the same new key are pre-existing duplicates of
    //      one logical cluster (e.g. an 'active' row later demoted to 'stats' kept its old
    //      key). Keep one canonical row per new key; the rest are deleted (their stats
    //      children cascade-delete and re-sync on the next stats pull).
    //   3. Two-step rekey via a unique temporary key (ctid) to avoid transient PK
    //      collisions where one row's NEW key equals another's OLD key mid-update.
    // All steps are idempotent: after the first run their WHERE clauses match nothing.
    `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'wb_cluster_stats_cluster_key_fkey'
            AND confupdtype = 'c'
        ) THEN
          ALTER TABLE ${tableName("wb_cluster_stats")}
            DROP CONSTRAINT IF EXISTS wb_cluster_stats_cluster_key_fkey;
          ALTER TABLE ${tableName("wb_cluster_stats")}
            ADD CONSTRAINT wb_cluster_stats_cluster_key_fkey
            FOREIGN KEY (cluster_key) REFERENCES ${tableName("wb_clusters")}(cluster_key)
            ON UPDATE CASCADE ON DELETE CASCADE;
        END IF;
      END $$
    `,
    `
      WITH recomputed AS (
        SELECT cluster_key,
          CASE WHEN source_kind = 'stats' OR advert_id IS NULL
            THEN nm_id::text || ':' || source_kind || ':' || normalized_cluster_name
            ELSE nm_id::text || ':' || advert_id::text || ':' || source_kind || ':' || normalized_cluster_name
          END AS new_key
        FROM ${tableName("wb_clusters")}
      ),
      ranked AS (
        SELECT cluster_key,
          ROW_NUMBER() OVER (PARTITION BY new_key ORDER BY cluster_key) AS rn
        FROM recomputed
      )
      DELETE FROM ${tableName("wb_clusters")}
      WHERE cluster_key IN (SELECT cluster_key FROM ranked WHERE rn > 1)
    `,
    `
      UPDATE ${tableName("wb_clusters")}
      SET cluster_key = '__ck_migrate__:' || ctid::text
      WHERE cluster_key <> CASE
        WHEN source_kind = 'stats' OR advert_id IS NULL
          THEN nm_id::text || ':' || source_kind || ':' || normalized_cluster_name
        ELSE nm_id::text || ':' || advert_id::text || ':' || source_kind || ':' || normalized_cluster_name
      END
    `,
    `
      UPDATE ${tableName("wb_clusters")}
      SET cluster_key = CASE
        WHEN source_kind = 'stats' OR advert_id IS NULL
          THEN nm_id::text || ':' || source_kind || ':' || normalized_cluster_name
        ELSE nm_id::text || ':' || advert_id::text || ':' || source_kind || ':' || normalized_cluster_name
      END
      WHERE cluster_key LIKE '__ck_migrate__:%'
    `,
  ];
}

export function getSnapshotAlterStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      ALTER TABLE ${tableName("wb_product_advertising_sheet_snapshots")}
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready'
    `,
    `
      ALTER TABLE ${tableName("wb_product_advertising_sheet_snapshots")}
      ADD COLUMN IF NOT EXISTS built_from_export_request_id TEXT NULL
    `,
    `
      ALTER TABLE ${tableName("wb_product_advertising_sheet_snapshots")}
      ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'materialized'
    `,
    `
      ALTER TABLE ${tableName("wb_product_advertising_sheet_snapshots")}
      ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ NULL
    `,
    `
      ALTER TABLE ${tableName("wb_product_advertising_sheet_snapshots")}
      ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ NULL
    `,
    `
      ALTER TABLE ${tableName("wb_product_advertising_sheet_snapshots")}
      ADD COLUMN IF NOT EXISTS failure_reason TEXT NULL
    `,
  ];
}

export function getCabinetQueryMapDeduplicationStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    // Deduplicate wb_cabinet_cluster_queries and enforce UNIQUE (nm_id, advert_id, normalized_query_text).
    // The entire block is skipped if the constraint already exists (idempotent on repeated restarts).
    // The DELETE uses a window-function USING strategy which is much faster than NOT IN on large tables.
    `
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'wb_cabinet_cluster_queries_nm_advert_query_unique'
        ) THEN
          RETURN;
        END IF;

        -- Remove duplicates: keep the canonical row per (nm_id, advert_id, normalized_query_text).
        -- Prefer the row where cluster name = query text; fall back to latest captured_at.
        DELETE FROM ${tableName("wb_cabinet_cluster_queries")} d
        USING (
          SELECT cabinet_query_key,
                 FIRST_VALUE(cabinet_query_key) OVER (
                   PARTITION BY nm_id, advert_id, normalized_query_text
                   ORDER BY (CASE WHEN normalized_cluster_name = normalized_query_text THEN 0 ELSE 1 END) ASC,
                            captured_at DESC,
                            cabinet_query_key ASC
                 ) AS keep_key
          FROM ${tableName("wb_cabinet_cluster_queries")}
        ) subq
        WHERE d.cabinet_query_key = subq.cabinet_query_key
          AND d.cabinet_query_key != subq.keep_key;

        -- Enforce one cluster per (nm_id, advert_id, query) going forward.
        ALTER TABLE ${tableName("wb_cabinet_cluster_queries")}
        ADD CONSTRAINT wb_cabinet_cluster_queries_nm_advert_query_unique
        UNIQUE (nm_id, advert_id, normalized_query_text);
      END $$
    `,
  ];
}

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
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
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

/**
 * wb_product_jam_daily: daily JAM metrics aggregated per product.
 * Materialized from wb_product_search_text_range_snapshots + _rows after each nightly JAM sync.
 * One row per (nm_id, jam_date). Frontend reads with simple SELECT for any date range.
 */
export function getJamDailyCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_jam_daily")} (
        nm_id             BIGINT      NOT NULL,
        jam_date          DATE        NOT NULL,
        avg_position      NUMERIC     NULL,
        best_position     NUMERIC     NULL,
        total_frequency   BIGINT      NOT NULL DEFAULT 0,
        top_frequency     BIGINT      NOT NULL DEFAULT 0,
        total_clicks      INT         NOT NULL DEFAULT 0,
        total_add_to_cart INT         NOT NULL DEFAULT 0,
        total_orders      INT         NOT NULL DEFAULT 0,
        query_count       INT         NOT NULL DEFAULT 0,
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, jam_date)
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_jam_daily_date_idx
        ON ${tableName("wb_product_jam_daily")} (jam_date DESC)
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
        confirmed_at       TIMESTAMPTZ,
        retry_at           TIMESTAMPTZ,
        last_error         TEXT,
        attempt_count      INT         NOT NULL DEFAULT 0,
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_price_changes_status_idx
        ON ${tableName("wb_product_price_changes")} (sync_status)
    `,
  ];
}
