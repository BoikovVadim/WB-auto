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
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, order_date)
      )
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
  ];
}
