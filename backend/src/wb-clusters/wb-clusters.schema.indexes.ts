import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

export function getIndexStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE INDEX IF NOT EXISTS wb_clusters_nm_id_idx
      ON ${tableName("wb_clusters")} (nm_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_clusters_nm_id_normalized_cluster_name_idx
      ON ${tableName("wb_clusters")} (nm_id, normalized_cluster_name)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_stats_nm_id_idx
      ON ${tableName("wb_cluster_stats")} (nm_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_daily_stats_nm_id_idx
      ON ${tableName("wb_cluster_daily_stats")} (nm_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_daily_stats_nm_id_stat_date_idx
      ON ${tableName("wb_cluster_daily_stats")} (nm_id, stat_date DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_bids_nm_id_idx
      ON ${tableName("wb_cluster_bids")} (nm_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_bids_advert_nm_cluster_idx
      ON ${tableName("wb_cluster_bids")} (advert_id, nm_id, normalized_cluster_name)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_actions_nm_id_idx
      ON ${tableName("wb_cluster_actions")} (nm_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_actions_advert_nm_cluster_idx
      ON ${tableName("wb_cluster_actions")} (advert_id, nm_id, normalized_cluster_name)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_bid_jobs_status_attempt_idx
      ON ${tableName("wb_cluster_bid_jobs")} (status, processing_phase, next_attempt_at, created_at)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_action_jobs_status_attempt_idx
      ON ${tableName("wb_cluster_action_jobs")} (status, next_attempt_at, created_at)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_bid_jobs_advert_nm_idx
      ON ${tableName("wb_cluster_bid_jobs")} (advert_id, nm_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_action_jobs_advert_nm_idx
      ON ${tableName("wb_cluster_action_jobs")} (advert_id, nm_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_bid_job_items_job_idx
      ON ${tableName("wb_cluster_bid_job_items")} (job_id, normalized_cluster_name)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_action_job_items_job_idx
      ON ${tableName("wb_cluster_action_job_items")} (job_id, normalized_cluster_name)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_campaign_minus_phrases_nm_id_idx
      ON ${tableName("wb_campaign_minus_phrases")} (nm_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_campaign_minus_phrases_nm_advert_idx
      ON ${tableName("wb_campaign_minus_phrases")} (nm_id, advert_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_keyword_stats_advert_date_idx
      ON ${tableName("wb_keyword_stats")} (advert_id, stat_date)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_queries_nm_id_query_idx
      ON ${tableName("wb_cluster_queries")} (nm_id, normalized_query_text)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cabinet_cluster_queries_nm_id_query_idx
      ON ${tableName("wb_cabinet_cluster_queries")} (nm_id, normalized_query_text)
    `,
    `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS wb_cabinet_cluster_queries_nm_advert_cluster_idx
      ON ${tableName("wb_cabinet_cluster_queries")} (nm_id, advert_id, normalized_cluster_name)
    `,
    `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS wb_cluster_queries_nm_advert_cluster_idx
      ON ${tableName("wb_cluster_queries")} (nm_id, advert_id, normalized_cluster_name)
    `,
    `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS wb_cluster_daily_stats_nm_advert_date_idx
      ON ${tableName("wb_cluster_daily_stats")} (nm_id, advert_id, stat_date DESC)
    `,
    // Eliminates the Merge Left Join 1.6M row explosion in PATH B cluster-query queries.
    // Without this index, JOIN wb_clusters ON (nm_id, advert_id, normalized_cluster_name)
    // falls back to a merge join on advert_id only and then filters out 1.6M rows.
    `
      CREATE INDEX IF NOT EXISTS wb_clusters_nm_advert_norm_cluster_idx
      ON ${tableName("wb_clusters")} (nm_id, advert_id, normalized_cluster_name)
    `,
    // Speeds up the frequency JOIN in PATH B: LEFT JOIN wb_search_query_frequencies ON normalized_query_text.
    `
      CREATE INDEX IF NOT EXISTS wb_search_query_freq_norm_text_idx
      ON ${tableName("wb_search_query_frequencies")} (normalized_query_text)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_campaign_products_nm_id_idx
      ON ${tableName("wb_campaign_products")} (nm_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_catalog_vendor_code_idx
      ON ${tableName("wb_product_catalog")} (vendor_code)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_search_query_frequencies_report_end_idx
      ON ${tableName("wb_search_query_frequencies")} (report_end_date DESC, synced_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_search_text_range_snapshots_nm_period_idx
      ON ${tableName("wb_product_search_text_range_snapshots")} (nm_id, start_date, end_date, synced_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_search_text_range_rows_snapshot_query_idx
      ON ${tableName("wb_product_search_text_range_rows")} (snapshot_key, normalized_query_text)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_advertising_sheet_snapshots_nm_period_idx
      ON ${tableName("wb_product_advertising_sheet_snapshots")} (nm_id, start_date, end_date, schema_version, synced_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_advertising_sheet_snapshots_ready_lookup_idx
      ON ${tableName("wb_product_advertising_sheet_snapshots")} (nm_id, status, ready_at DESC, synced_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_advertising_sheet_snapshots_exact_ready_idx
      ON ${tableName("wb_product_advertising_sheet_snapshots")} (
        nm_id,
        status,
        start_date,
        end_date,
        schema_version,
        ready_at DESC,
        synced_at DESC
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_product_advertising_sheet_snapshots_range_ready_idx
      ON ${tableName("wb_product_advertising_sheet_snapshots")} (
        nm_id,
        status,
        start_date,
        end_date,
        ready_at DESC,
        synced_at DESC
      )
    `,
  ];
}
