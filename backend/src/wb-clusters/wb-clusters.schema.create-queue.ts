import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

export function getClusterQueueCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_daily_stats")} (
        daily_stat_key TEXT PRIMARY KEY,
        advert_id BIGINT NOT NULL,
        nm_id BIGINT NOT NULL,
        stat_date DATE NOT NULL,
        cluster_name TEXT NOT NULL,
        normalized_cluster_name TEXT NOT NULL,
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
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_advert_daily_spend")} (
        advert_id BIGINT NOT NULL,
        nm_id BIGINT NOT NULL,
        stat_date DATE NOT NULL,
        spend NUMERIC NULL,
        currency TEXT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (advert_id, nm_id, stat_date)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_bids")} (
        bid_key TEXT PRIMARY KEY,
        advert_id BIGINT NOT NULL,
        nm_id BIGINT NOT NULL,
        cluster_name TEXT NOT NULL,
        normalized_cluster_name TEXT NOT NULL,
        bid NUMERIC NULL,
        bid_sync_status TEXT NULL,
        bid_confirmed_at TIMESTAMPTZ NULL,
        bid_retry_at TIMESTAMPTZ NULL,
        bid_last_error TEXT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_actions")} (
        action_key TEXT PRIMARY KEY,
        advert_id BIGINT NOT NULL,
        nm_id BIGINT NOT NULL,
        cluster_name TEXT NOT NULL,
        normalized_cluster_name TEXT NOT NULL,
        desired_is_active BOOLEAN NOT NULL,
        action_sync_status TEXT NULL,
        action_retry_at TIMESTAMPTZ NULL,
        action_last_error TEXT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_bid_jobs")} (
        job_id TEXT PRIMARY KEY,
        advert_id BIGINT NOT NULL,
        nm_id BIGINT NOT NULL,
        status TEXT NOT NULL,
        processing_phase TEXT NOT NULL DEFAULT 'write',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_attempt_at TIMESTAMPTZ NULL,
        last_error TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_action_jobs")} (
        job_id TEXT PRIMARY KEY,
        advert_id BIGINT NOT NULL,
        nm_id BIGINT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_attempt_at TIMESTAMPTZ NULL,
        last_error TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_preset_snapshot_jobs")} (
        job_id TEXT PRIMARY KEY,
        source_export_request_id TEXT NOT NULL,
        preset_export_request_id TEXT NULL,
        requested_start_date DATE NOT NULL,
        requested_end_date DATE NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_attempt_at TIMESTAMPTZ NULL,
        last_error TEXT NULL,
        reason TEXT NULL,
        nm_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (source_export_request_id, requested_start_date, requested_end_date)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_bid_job_items")} (
        job_item_key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES ${tableName("wb_cluster_bid_jobs")}(job_id) ON DELETE CASCADE,
        cluster_name TEXT NOT NULL,
        normalized_cluster_name TEXT NOT NULL,
        desired_bid NUMERIC NOT NULL,
        confirmed_bid NUMERIC NULL,
        item_status TEXT NOT NULL DEFAULT 'queued',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (job_id, normalized_cluster_name)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_action_job_items")} (
        job_item_key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES ${tableName("wb_cluster_action_jobs")}(job_id) ON DELETE CASCADE,
        cluster_name TEXT NOT NULL,
        normalized_cluster_name TEXT NOT NULL,
        desired_is_active BOOLEAN NOT NULL,
        item_status TEXT NOT NULL DEFAULT 'queued',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (job_id, normalized_cluster_name)
      )
    `,
  ];
}

