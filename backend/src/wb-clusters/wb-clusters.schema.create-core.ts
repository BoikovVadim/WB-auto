import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

export function getCoreCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_sync_runs")} (
        id TEXT PRIMARY KEY,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ NULL,
        campaigns_seen INTEGER NOT NULL DEFAULT 0,
        campaigns_synced INTEGER NOT NULL DEFAULT 0,
        products_seen INTEGER NOT NULL DEFAULT 0,
        clusters_upserted INTEGER NOT NULL DEFAULT 0,
        stats_rows_upserted INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        has_partial_failure BOOLEAN NOT NULL DEFAULT FALSE,
        error_message TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_sync_state")} (
        state_key TEXT PRIMARY KEY,
        last_completed_advert_id BIGINT NULL,
        last_sync_run_id TEXT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_campaigns")} (
        advert_id BIGINT PRIMARY KEY,
        campaign_type INTEGER NOT NULL,
        campaign_status INTEGER NOT NULL,
        payment_type TEXT NULL,
        bid_type TEXT NULL,
        currency TEXT NULL,
        name TEXT NULL,
        change_time TIMESTAMPTZ NULL,
        created_at_wb TIMESTAMPTZ NULL,
        started_at_wb TIMESTAMPTZ NULL,
        updated_at_wb TIMESTAMPTZ NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_campaign_products")} (
        advert_id BIGINT NOT NULL REFERENCES ${tableName("wb_campaigns")}(advert_id) ON DELETE CASCADE,
        nm_id BIGINT NOT NULL,
        subject_id INTEGER NULL,
        subject_name TEXT NULL,
        search_bid NUMERIC NULL,
        search_bid_synced_at TIMESTAMPTZ NULL,
        min_search_bid NUMERIC NULL,
        min_search_bid_synced_at TIMESTAMPTZ NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (advert_id, nm_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_catalog")} (
        nm_id BIGINT PRIMARY KEY,
        vendor_code TEXT NOT NULL,
        product_name TEXT NOT NULL,
        brand_name TEXT NOT NULL,
        subject_name TEXT NOT NULL,
        subject_id BIGINT NULL,
        category_name TEXT NULL,
        source_export_request_id TEXT NULL,
        first_seen_at TIMESTAMPTZ NULL,
        last_seen_at TIMESTAMPTZ NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
  ];
}

export function getClusterCoreCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_clusters")} (
        cluster_key TEXT PRIMARY KEY,
        advert_id BIGINT NULL REFERENCES ${tableName("wb_campaigns")}(advert_id) ON DELETE SET NULL,
        nm_id BIGINT NOT NULL,
        cluster_name TEXT NOT NULL,
        normalized_cluster_name TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        is_active BOOLEAN NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_stats")} (
        cluster_key TEXT PRIMARY KEY REFERENCES ${tableName("wb_clusters")}(cluster_key) ON DELETE CASCADE,
        advert_id BIGINT NULL,
        nm_id BIGINT NOT NULL,
        cluster_name TEXT NOT NULL,
        views NUMERIC NULL,
        clicks NUMERIC NULL,
        orders NUMERIC NULL,
        add_to_cart NUMERIC NULL,
        shks NUMERIC NULL,
        ctr NUMERIC NULL,
        avg_position NUMERIC NULL,
        cpc NUMERIC NULL,
        cpm NUMERIC NULL,
        spend NUMERIC NULL,
        currency TEXT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
  ];
}

