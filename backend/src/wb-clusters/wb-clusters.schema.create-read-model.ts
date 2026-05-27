import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

export function getReadModelCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_campaign_minus_phrases")} (
        minus_phrase_key TEXT PRIMARY KEY,
        advert_id BIGINT NOT NULL,
        nm_id BIGINT NOT NULL,
        phrase TEXT NOT NULL,
        normalized_phrase TEXT NOT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_keyword_stats")} (
        keyword_stat_key TEXT PRIMARY KEY,
        advert_id BIGINT NOT NULL,
        stat_date DATE NOT NULL,
        keyword TEXT NOT NULL,
        normalized_keyword TEXT NOT NULL,
        views NUMERIC NULL,
        clicks NUMERIC NULL,
        ctr NUMERIC NULL,
        spend NUMERIC NULL,
        currency TEXT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_queries")} (
        cluster_query_key TEXT PRIMARY KEY,
        advert_id BIGINT NOT NULL,
        nm_id BIGINT NOT NULL,
        cluster_name TEXT NOT NULL,
        normalized_cluster_name TEXT NOT NULL,
        query_text TEXT NOT NULL,
        normalized_query_text TEXT NOT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cabinet_cluster_queries")} (
        cabinet_query_key TEXT PRIMARY KEY,
        advert_id BIGINT NOT NULL,
        nm_id BIGINT NOT NULL,
        cluster_name TEXT NOT NULL,
        normalized_cluster_name TEXT NOT NULL,
        query_text TEXT NOT NULL,
        normalized_query_text TEXT NOT NULL,
        capture_mode TEXT NOT NULL,
        source_endpoint TEXT NULL,
        captured_at TIMESTAMPTZ NOT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_search_query_frequencies")} (
        normalized_query_text TEXT PRIMARY KEY,
        normalized_query_identity TEXT NOT NULL,
        normalized_query_stem TEXT NOT NULL,
        query_text TEXT NOT NULL,
        monthly_frequency NUMERIC NOT NULL,
        report_type TEXT NOT NULL,
        report_id TEXT NULL,
        download_id TEXT NULL,
        report_start_date DATE NOT NULL,
        report_end_date DATE NOT NULL,
        subject_name TEXT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_query_frequency_history")} (
        id BIGSERIAL PRIMARY KEY,
        normalized_query_text TEXT NOT NULL,
        query_text TEXT NOT NULL,
        monthly_frequency NUMERIC NOT NULL,
        report_start_date DATE NOT NULL,
        report_end_date DATE NOT NULL,
        snapshotted_week DATE NOT NULL,
        snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (normalized_query_text, snapshotted_week)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_search_text_range_snapshots")} (
        snapshot_key TEXT PRIMARY KEY,
        nm_id BIGINT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (nm_id, start_date, end_date)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_jam_attempt_log")} (
        nm_id BIGINT NOT NULL,
        date DATE NOT NULL,
        last_attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, date)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_search_text_range_rows")} (
        row_key TEXT PRIMARY KEY,
        snapshot_key TEXT NOT NULL REFERENCES ${tableName("wb_product_search_text_range_snapshots")}(snapshot_key) ON DELETE CASCADE,
        query_text TEXT NOT NULL,
        normalized_query_text TEXT NOT NULL,
        frequency NUMERIC NULL,
        week_frequency NUMERIC NULL,
        avg_position_current NUMERIC NULL,
        avg_position_dynamics NUMERIC NULL,
        orders_current NUMERIC NULL,
        orders_dynamics NUMERIC NULL,
        open_card_current NUMERIC NULL,
        open_card_dynamics NUMERIC NULL,
        add_to_cart_current NUMERIC NULL,
        add_to_cart_dynamics NUMERIC NULL,
        open_to_cart_current NUMERIC NULL,
        open_to_cart_dynamics NUMERIC NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (snapshot_key, normalized_query_text)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_advertising_sheet_snapshots")} (
        snapshot_key TEXT PRIMARY KEY,
        nm_id BIGINT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        schema_version INTEGER NOT NULL,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        built_from_export_request_id TEXT NULL,
        source_kind TEXT NOT NULL DEFAULT 'materialized',
        ready_at TIMESTAMPTZ NULL,
        last_attempt_at TIMESTAMPTZ NULL,
        failure_reason TEXT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (nm_id, start_date, end_date, schema_version)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_workspace_snapshots")} (
        workspace_key TEXT PRIMARY KEY,
        nm_id BIGINT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        schema_version INTEGER NOT NULL,
        payload JSONB NOT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (nm_id, start_date, end_date, schema_version)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_workspace_campaign_rows")} (
        campaign_rows_key TEXT PRIMARY KEY,
        nm_id BIGINT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        schema_version INTEGER NOT NULL,
        advert_id BIGINT NOT NULL,
        payload JSONB NOT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (nm_id, start_date, end_date, schema_version, advert_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_product_workspace_cluster_queries")} (
        cluster_queries_key TEXT PRIMARY KEY,
        nm_id BIGINT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        schema_version INTEGER NOT NULL,
        advert_id BIGINT NOT NULL,
        cluster_key TEXT NOT NULL,
        cluster_name TEXT NOT NULL,
        payload JSONB NOT NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (nm_id, start_date, end_date, schema_version, advert_id, cluster_key)
      )
    `,
  ];
}

