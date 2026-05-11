import type {
  PromotionCampaignCountResponse,
  WbClustersSyncRunSummary,
} from "./wb-clusters.types";
import type {
  ClusterSyncRunRecord,
  RawArchivePayloadRow,
} from "./wb-clusters.repository.types";

import { WbClustersRepositorySyncRunWrite } from "./wb-clusters.repository.sync-run-write";

export abstract class WbClustersRepositorySyncRunRead extends WbClustersRepositorySyncRunWrite {
  async getLatestCampaignCountsArchive() {
    if (!this.isConfigured()) {
      return null as PromotionCampaignCountResponse | null;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<RawArchivePayloadRow>(
      `
        SELECT payload
        FROM ${this.tableName("wb_cluster_raw_archive")}
        WHERE archive_type = 'campaign-counts'
        ORDER BY created_at DESC
        LIMIT 1
      `,
    );

    return result.rows[0]?.payload ?? null;
  }

  async getLatestMonthlyQueryFrequencySnapshot() {
    if (!this.isConfigured()) {
      return null as {
        reportEndDate: string | null;
        syncedAt: string | null;
      } | null;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{
      report_end_date: string | null;
      synced_at: string | null;
    }>(
      `
        SELECT
          report_end_date::text AS report_end_date,
          MAX(synced_at)::text AS synced_at
        FROM ${this.tableName("wb_search_query_frequencies")}
        GROUP BY report_end_date
        ORDER BY report_end_date DESC
        LIMIT 1
      `,
    );

    const row = result.rows[0] ?? null;
    if (!row) {
      return null;
    }

    return {
      reportEndDate: row.report_end_date,
      syncedAt: row.synced_at,
    };
  }

  async getDashboardCounts() {
    if (!this.isConfigured()) {
      return {
        campaignsStored: 0,
        productsStored: 0,
        clustersStored: 0,
        statsRowsStored: 0,
      };
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    const [campaigns, products, clusters, statsRows] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${this.tableName("wb_campaigns")}`,
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${this.tableName("wb_campaign_products")}`,
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${this.tableName("wb_clusters")}`,
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${this.tableName("wb_cluster_stats")}`,
      ),
    ]);

    return {
      campaignsStored: Number(campaigns.rows[0]?.count ?? "0"),
      productsStored: Number(products.rows[0]?.count ?? "0"),
      clustersStored: Number(clusters.rows[0]?.count ?? "0"),
      statsRowsStored: Number(statsRows.rows[0]?.count ?? "0"),
    };
  }

  async getLastSyncRun(): Promise<WbClustersSyncRunSummary | null> {
    if (!this.isConfigured()) {
      return null;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<ClusterSyncRunRecord>(
      `
        SELECT
          id,
          trigger,
          status,
          started_at,
          finished_at,
          campaigns_seen,
          campaigns_synced,
          products_seen,
          clusters_upserted,
          stats_rows_upserted,
          warning_count,
          has_partial_failure,
          error_message
        FROM ${this.tableName("wb_cluster_sync_runs")}
        ORDER BY started_at DESC
        LIMIT 1
      `,
    );

    return this.mapSyncRun(result.rows[0] ?? null);
  }

  async getSyncRun(syncRunId: string): Promise<WbClustersSyncRunSummary | null> {
    if (!this.isConfigured()) {
      return null;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<ClusterSyncRunRecord>(
      `
        SELECT
          id,
          trigger,
          status,
          started_at,
          finished_at,
          campaigns_seen,
          campaigns_synced,
          products_seen,
          clusters_upserted,
          stats_rows_upserted,
          warning_count,
          has_partial_failure,
          error_message
        FROM ${this.tableName("wb_cluster_sync_runs")}
        WHERE id = $1
        LIMIT 1
      `,
      [syncRunId],
    );

    return this.mapSyncRun(result.rows[0] ?? null);
  }

  async getSyncCursorState(stateKey = "global") {
    if (!this.isConfigured()) {
      return {
        lastCompletedAdvertId: null as number | null,
        lastSyncRunId: null as string | null,
      };
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{
      last_completed_advert_id: string | null;
      last_sync_run_id: string | null;
    }>(
      `
        SELECT
          last_completed_advert_id::text AS last_completed_advert_id,
          last_sync_run_id
        FROM ${this.tableName("wb_cluster_sync_state")}
        WHERE state_key = $1
        LIMIT 1
      `,
      [stateKey],
    );

    const row = result.rows[0] ?? null;
    return {
      lastCompletedAdvertId:
        row?.last_completed_advert_id === null || row?.last_completed_advert_id === undefined
          ? null
          : Number(row.last_completed_advert_id),
      lastSyncRunId: row?.last_sync_run_id ?? null,
    };
  }

}
