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
