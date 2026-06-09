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
