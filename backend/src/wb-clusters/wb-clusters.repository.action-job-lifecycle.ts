import { randomUUID } from "node:crypto";

import type {
  ClusterActionJobStatus,
} from "./wb-clusters.types";
import type {
  ClusterActionJobRecord,
} from "./wb-clusters.repository.types";
import { WbClustersRepositoryBidJobPersistence } from "./wb-clusters.repository.bid-job-persistence";

export abstract class WbClustersRepositoryActionJobLifecycle extends WbClustersRepositoryBidJobPersistence {
  async createClusterActionJob(input: {
    advertId: number;
    nmId: number;
    actions: Array<{
      clusterName: string;
      desiredIsActive: boolean;
    }>;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();
    const jobId = `cluster-action-job-${Date.now()}-${randomUUID()}`;
    const queuedAt = new Date().toISOString();

    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO ${this.tableName("wb_cluster_action_jobs")} (
            job_id,
            advert_id,
            nm_id,
            status,
            next_attempt_at,
            created_at,
            updated_at
          ) VALUES ($1,$2,$3,$4,$5,$5,$5)
        `,
        [jobId, input.advertId, input.nmId, "queued", queuedAt],
      );

      for (const action of input.actions) {
        const normalizedClusterName = this.normalizeQuery(action.clusterName);
        await client.query(
          `
            UPDATE ${this.tableName("wb_cluster_action_job_items")} AS items
            SET
              item_status = 'failed',
              updated_at = $4
            FROM ${this.tableName("wb_cluster_action_jobs")} AS jobs
            WHERE jobs.job_id = items.job_id
              AND jobs.advert_id = $1
              AND jobs.nm_id = $2
              AND jobs.status IN ('queued', 'running', 'retry_scheduled')
              AND items.normalized_cluster_name = $3
              AND items.item_status IN ('queued', 'running', 'retry_scheduled')
          `,
          [input.advertId, input.nmId, normalizedClusterName, queuedAt],
        );
        await client.query(
          `
            UPDATE ${this.tableName("wb_cluster_action_jobs")} AS jobs
            SET
              status = 'failed',
              last_error = 'Superseded by newer cluster action command.',
              updated_at = $1
            WHERE jobs.advert_id = $2
              AND jobs.nm_id = $3
              AND jobs.job_id <> $4
              AND jobs.status IN ('queued', 'running', 'retry_scheduled')
              AND NOT EXISTS (
                SELECT 1
                FROM ${this.tableName("wb_cluster_action_job_items")} items
                WHERE items.job_id = jobs.job_id
                  AND items.item_status IN ('queued', 'running', 'retry_scheduled')
              )
          `,
          [queuedAt, input.advertId, input.nmId, jobId],
        );

        await client.query(
          `
            INSERT INTO ${this.tableName("wb_cluster_action_job_items")} (
              job_item_key,
              job_id,
              cluster_name,
              normalized_cluster_name,
              desired_is_active,
              item_status,
              created_at,
              updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
            ON CONFLICT (job_id, normalized_cluster_name) DO UPDATE
            SET
              cluster_name = EXCLUDED.cluster_name,
              desired_is_active = EXCLUDED.desired_is_active,
              item_status = EXCLUDED.item_status,
              updated_at = EXCLUDED.updated_at
          `,
          [
            `cluster-action-job-item-${randomUUID()}`,
            jobId,
            action.clusterName,
            normalizedClusterName,
            action.desiredIsActive,
            "queued",
            queuedAt,
          ],
        );
      }

      await client.query("COMMIT");
      return { jobId, queuedAt };
    } catch (error) {
      await this.rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimReadyClusterActionJobs(limit: number) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const jobsResult = await client.query<ClusterActionJobRecord>(
        `
          SELECT
            job_id,
            advert_id::text AS advert_id,
            nm_id::text AS nm_id,
            status,
            attempt_count,
            next_attempt_at::text AS next_attempt_at,
            last_attempt_at::text AS last_attempt_at,
            last_error,
            created_at::text AS created_at,
            updated_at::text AS updated_at
          FROM ${this.tableName("wb_cluster_action_jobs")}
          WHERE (
            (
              status IN ('queued', 'retry_scheduled')
              AND next_attempt_at <= NOW()
            )
            OR (
              status = 'running'
              AND COALESCE(last_attempt_at, created_at) <= NOW() - INTERVAL '90 seconds'
            )
          )
          ORDER BY next_attempt_at ASC, created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        `,
        [limit],
      );

      if (jobsResult.rows.length === 0) {
        await client.query("COMMIT");
        return [] as Array<{
          jobId: string;
          advertId: number;
          nmId: number;
          status: ClusterActionJobStatus;
          attemptCount: number;
          nextAttemptAt: string;
          lastAttemptAt: string | null;
          lastError: string | null;
          createdAt: string;
          updatedAt: string;
          items: Array<{
            clusterName: string;
            normalizedClusterName: string;
            desiredIsActive: boolean;
            itemStatus: string;
            createdAt: string;
            updatedAt: string;
          }>;
        }>;
      }

      const jobIds = jobsResult.rows.map((row) => row.job_id);
      await client.query(
        `
          UPDATE ${this.tableName("wb_cluster_action_jobs")}
          SET
            status = 'running',
            attempt_count = attempt_count + 1,
            last_attempt_at = NOW(),
            updated_at = NOW()
          WHERE job_id = ANY($1::text[])
        `,
        [jobIds],
      );
      await client.query(
        `
          UPDATE ${this.tableName("wb_cluster_action_job_items")}
          SET
            item_status = 'running',
            updated_at = NOW()
          WHERE job_id = ANY($1::text[])
            AND item_status IN ('queued', 'retry_scheduled')
        `,
        [jobIds],
      );

      const itemsResult = await client.query<{
        job_id: string;
        cluster_name: string;
        normalized_cluster_name: string;
        desired_is_active: boolean;
        item_status: string;
        created_at: string;
        updated_at: string;
      }>(
        `
          SELECT
            job_id,
            cluster_name,
            normalized_cluster_name,
            desired_is_active,
            item_status,
            created_at::text AS created_at,
            updated_at::text AS updated_at
          FROM ${this.tableName("wb_cluster_action_job_items")}
          WHERE job_id = ANY($1::text[])
          ORDER BY created_at ASC
        `,
        [jobIds],
      );

      await client.query("COMMIT");

      return jobsResult.rows.map((job) => ({
        jobId: job.job_id,
        advertId: Number(job.advert_id),
        nmId: Number(job.nm_id),
        status: "running" as const,
        attemptCount: job.attempt_count + 1,
        nextAttemptAt: job.next_attempt_at,
        lastAttemptAt: job.last_attempt_at,
        lastError: job.last_error,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        items: itemsResult.rows
          .filter((item) => item.job_id === job.job_id)
          .map((item) => ({
            clusterName: item.cluster_name,
            normalizedClusterName: item.normalized_cluster_name,
            desiredIsActive: item.desired_is_active,
            itemStatus: item.item_status,
            createdAt: item.created_at,
            updatedAt: item.updated_at,
          })),
      }));
    } catch (error) {
      await this.rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

}
