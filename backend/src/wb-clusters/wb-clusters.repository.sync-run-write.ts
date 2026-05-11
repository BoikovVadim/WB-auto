import { randomUUID } from "node:crypto";

import type { ClusterSyncStatus, ClusterSyncTrigger } from "./wb-clusters.types";
import { WbClustersRepositoryBase } from "./wb-clusters.repository.base";

export abstract class WbClustersRepositorySyncRunWrite extends WbClustersRepositoryBase {
  async createSyncRun(trigger: ClusterSyncTrigger) {
    await this.ensureSchemaOrThrow();

    const id = `cluster-sync-${Date.now()}-${randomUUID()}`;
    const pool = this.getPool();

    await pool.query(
      `
        INSERT INTO ${this.tableName("wb_cluster_sync_runs")} (
          id,
          trigger,
          status,
          started_at
        ) VALUES ($1, $2, $3, NOW())
      `,
      [id, trigger, "running"],
    );

    return id;
  }

  async updateSyncRunProgress(
    syncRunId: string,
    summary: {
      campaignsSeen: number;
      campaignsSynced: number;
      productsSeen: number;
      clustersUpserted: number;
      statsRowsUpserted: number;
      warningCount?: number;
      hasPartialFailure?: boolean;
      errorMessage?: string | null;
    },
  ) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    await pool.query(
      `
        UPDATE ${this.tableName("wb_cluster_sync_runs")}
        SET
          campaigns_seen = $2,
          campaigns_synced = $3,
          products_seen = $4,
          clusters_upserted = $5,
          stats_rows_upserted = $6,
          warning_count = $7,
          has_partial_failure = $8,
          error_message = $9,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        syncRunId,
        summary.campaignsSeen,
        summary.campaignsSynced,
        summary.productsSeen,
        summary.clustersUpserted,
        summary.statsRowsUpserted,
        summary.warningCount ?? 0,
        summary.hasPartialFailure ?? false,
        summary.errorMessage ?? null,
      ],
    );
  }

  async completeSyncRun(
    syncRunId: string,
    summary: {
      status: ClusterSyncStatus;
      campaignsSeen: number;
      campaignsSynced: number;
      productsSeen: number;
      clustersUpserted: number;
      statsRowsUpserted: number;
      warningCount?: number;
      hasPartialFailure?: boolean;
      errorMessage: string | null;
    },
  ) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    await pool.query(
      `
        UPDATE ${this.tableName("wb_cluster_sync_runs")}
        SET
          status = $2,
          finished_at = NOW(),
          campaigns_seen = $3,
          campaigns_synced = $4,
          products_seen = $5,
          clusters_upserted = $6,
          stats_rows_upserted = $7,
          warning_count = $8,
          has_partial_failure = $9,
          error_message = $10,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        syncRunId,
        summary.status,
        summary.campaignsSeen,
        summary.campaignsSynced,
        summary.productsSeen,
        summary.clustersUpserted,
        summary.statsRowsUpserted,
        summary.warningCount ?? 0,
        summary.hasPartialFailure ?? false,
        summary.errorMessage,
      ],
    );
  }

  async failStaleRunningSyncs(message: string) {
    if (!this.isConfigured()) {
      return 0;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query(
      `
        UPDATE ${this.tableName("wb_cluster_sync_runs")}
        SET
          status = 'failed',
          finished_at = NOW(),
          error_message = CASE
            WHEN error_message IS NULL OR error_message = '' THEN $1
            ELSE error_message
          END,
          updated_at = NOW()
        WHERE status = 'running'
      `,
      [message],
    );

    return result.rowCount ?? 0;
  }

  async updateSyncCursorState(input: {
    stateKey?: string;
    lastCompletedAdvertId: number | null;
    lastSyncRunId: string | null;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    await pool.query(
      `
        INSERT INTO ${this.tableName("wb_cluster_sync_state")} (
          state_key,
          last_completed_advert_id,
          last_sync_run_id,
          updated_at
        ) VALUES ($1, $2, $3, NOW())
        ON CONFLICT (state_key) DO UPDATE
        SET
          last_completed_advert_id = EXCLUDED.last_completed_advert_id,
          last_sync_run_id = EXCLUDED.last_sync_run_id,
          updated_at = NOW()
      `,
      [
        input.stateKey ?? "global",
        input.lastCompletedAdvertId,
        input.lastSyncRunId,
      ],
    );
  }

}
