import type {
  ClusterActionSyncStatus,
} from "./wb-clusters.types";
import { WbClustersRepositorySnapshotStorage } from "./wb-clusters.repository.snapshot-storage";
export abstract class WbClustersRepositoryCampaignActionPersistence extends WbClustersRepositorySnapshotStorage {
  async upsertClusterActions(
    actions: Array<{
      advert_id: number;
      nm_id: number;
      norm_query: string;
      desired_is_active: boolean;
      action_sync_status?: ClusterActionSyncStatus | null;
      action_retry_at?: string | null;
      action_last_error?: string | null;
    }>,
  ) {
    if (actions.length === 0) {
      return;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    for (const action of actions) {
      const actionKey = this.buildScopedTextKey(
        action.advert_id,
        action.nm_id,
        action.norm_query,
      );
      await pool.query(
        `
          INSERT INTO ${this.tableName("wb_cluster_actions")} (
            action_key,
            advert_id,
            nm_id,
            cluster_name,
            normalized_cluster_name,
            desired_is_active,
            action_sync_status,
            action_retry_at,
            action_last_error,
            synced_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
          ON CONFLICT (action_key) DO UPDATE
          SET
            cluster_name = EXCLUDED.cluster_name,
            normalized_cluster_name = EXCLUDED.normalized_cluster_name,
            desired_is_active = EXCLUDED.desired_is_active,
            action_sync_status = EXCLUDED.action_sync_status,
            action_retry_at = EXCLUDED.action_retry_at,
            action_last_error = EXCLUDED.action_last_error,
            synced_at = NOW()
        `,
        [
          actionKey,
          action.advert_id,
          action.nm_id,
          action.norm_query,
          this.normalizeQuery(action.norm_query),
          action.desired_is_active,
          action.action_sync_status ?? "confirmed",
          action.action_retry_at ?? null,
          action.action_last_error ?? null,
        ],
      );
    }
  }

  async getActiveClusterActionActivity(input?: { nmId?: number }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const params: Array<number> = [];
    const conditions = [
      `jobs.status IN ('queued', 'running', 'retry_scheduled')`,
      `EXISTS (
        SELECT 1
        FROM ${this.tableName("wb_cluster_action_job_items")} items
        WHERE items.job_id = jobs.job_id
          AND items.item_status IN ('queued', 'running', 'retry_scheduled')
      )`,
    ];

    if (typeof input?.nmId === "number") {
      params.push(input.nmId);
      conditions.push(`jobs.nm_id = $${params.length}`);
    }

    const result = await pool.query<{
      active_job_count: string;
      next_attempt_at: string | null;
    }>(
      `
        SELECT
          COUNT(*)::text AS active_job_count,
          MIN(jobs.next_attempt_at)::text AS next_attempt_at
        FROM ${this.tableName("wb_cluster_action_jobs")} jobs
        WHERE ${conditions.join("\n          AND ")}
      `,
      params,
    );

    const row = result.rows[0];
    return {
      activeJobCount: row ? Number(row.active_job_count) : 0,
      nextAttemptAt: row?.next_attempt_at ?? null,
    };
  }

  async getActiveClusterBidActivity(input?: { nmId?: number }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const params: Array<number> = [];
    const conditions = [
      `jobs.status IN ('queued', 'running', 'retry_scheduled')`,
      `EXISTS (
        SELECT 1
        FROM ${this.tableName("wb_cluster_bid_job_items")} items
        WHERE items.job_id = jobs.job_id
          AND items.item_status IN ('queued', 'running', 'retry_scheduled')
      )`,
    ];

    if (typeof input?.nmId === "number") {
      params.push(input.nmId);
      conditions.push(`jobs.nm_id = $${params.length}`);
    }

    const result = await pool.query<{
      active_job_count: string;
      next_attempt_at: string | null;
    }>(
      `
        SELECT
          COUNT(*)::text AS active_job_count,
          MIN(jobs.next_attempt_at)::text AS next_attempt_at
        FROM ${this.tableName("wb_cluster_bid_jobs")} jobs
        WHERE ${conditions.join("\n          AND ")}
      `,
      params,
    );

    const row = result.rows[0];
    return {
      activeJobCount: row ? Number(row.active_job_count) : 0,
      nextAttemptAt: row?.next_attempt_at ?? null,
    };
  }

}
