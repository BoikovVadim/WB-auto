import { randomUUID } from "node:crypto";

import type {
  ClusterBidJobStatus,
} from "./wb-clusters.types";
import type {
  ClusterBidJobRecord,
} from "./wb-clusters.repository.types";
import { WbClustersRepositorySyncState } from "./wb-clusters.repository.sync-state";

export abstract class WbClustersRepositoryBidJobLifecycle extends WbClustersRepositorySyncState {
  async createClusterBidJob(input: {
    advertId: number;
    nmId: number;
    bids: Array<{
      clusterName: string;
      bid: number;
    }>;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();
    const jobId = `cluster-bid-job-${Date.now()}-${randomUUID()}`;
    const queuedAt = new Date().toISOString();

    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO ${this.tableName("wb_cluster_bid_jobs")} (
            job_id,
            advert_id,
            nm_id,
            status,
            processing_phase,
            next_attempt_at,
            created_at,
            updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$6,$6)
        `,
        [jobId, input.advertId, input.nmId, "queued", "write", queuedAt],
      );

      for (const bid of input.bids) {
        const normalizedClusterName = this.normalizeQuery(bid.clusterName);
        await client.query(
          `
            UPDATE ${this.tableName("wb_cluster_bid_job_items")} AS items
            SET
              item_status = 'failed',
              updated_at = $4
            FROM ${this.tableName("wb_cluster_bid_jobs")} AS jobs
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
            UPDATE ${this.tableName("wb_cluster_bid_jobs")} AS jobs
            SET
              status = 'failed',
              last_error = 'Superseded by newer bid command.',
              updated_at = $1
            WHERE jobs.advert_id = $2
              AND jobs.nm_id = $3
              AND jobs.job_id <> $4
              AND jobs.status IN ('queued', 'running', 'retry_scheduled')
              AND NOT EXISTS (
                SELECT 1
                FROM ${this.tableName("wb_cluster_bid_job_items")} items
                WHERE items.job_id = jobs.job_id
                  AND items.item_status IN ('queued', 'running', 'retry_scheduled')
              )
          `,
          [queuedAt, input.advertId, input.nmId, jobId],
        );

        await client.query(
          `
            INSERT INTO ${this.tableName("wb_cluster_bid_job_items")} (
              job_item_key,
              job_id,
              cluster_name,
              normalized_cluster_name,
              desired_bid,
              item_status,
              created_at,
              updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
            ON CONFLICT (job_id, normalized_cluster_name) DO UPDATE
            SET
              cluster_name = EXCLUDED.cluster_name,
              desired_bid = EXCLUDED.desired_bid,
              item_status = EXCLUDED.item_status,
              updated_at = EXCLUDED.updated_at
          `,
          [
            `cluster-bid-job-item-${randomUUID()}`,
            jobId,
            bid.clusterName,
            normalizedClusterName,
            bid.bid,
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

  async claimReadyClusterBidJobs(limit: number) {
    return this.claimReadyClusterBidJobsByPhase("write", limit);
  }

  async claimReadyClusterBidReconcileJobs(limit: number) {
    return this.claimReadyClusterBidJobsByPhase("reconcile", limit);
  }

  protected async claimReadyClusterBidJobsByPhase(
    processingPhase: "write" | "reconcile",
    limit: number,
  ) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const jobsResult = await client.query<ClusterBidJobRecord>(
        `
          SELECT
            job_id,
            advert_id::text AS advert_id,
            nm_id::text AS nm_id,
            status,
            processing_phase,
            attempt_count,
            next_attempt_at::text AS next_attempt_at,
            last_attempt_at::text AS last_attempt_at,
            last_error,
            created_at::text AS created_at,
            updated_at::text AS updated_at
          FROM ${this.tableName("wb_cluster_bid_jobs")}
          WHERE (
            (
              status IN ('queued', 'retry_scheduled')
              AND processing_phase = $2
              AND next_attempt_at <= NOW() + CASE
                WHEN $2 = 'write' THEN INTERVAL '1 second'
                ELSE INTERVAL '0 second'
              END
            )
            OR (
              status = 'running'
              AND processing_phase = $2
              AND COALESCE(last_attempt_at, created_at) <= NOW() - INTERVAL '90 seconds'
            )
          )
          ORDER BY next_attempt_at ASC, created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        `,
        [limit, processingPhase],
      );

      if (jobsResult.rows.length === 0) {
        await client.query("COMMIT");
        return [] as Array<{
          jobId: string;
          advertId: number;
          nmId: number;
          status: ClusterBidJobStatus;
          processingPhase: "write" | "reconcile";
          attemptCount: number;
          nextAttemptAt: string;
          lastAttemptAt: string | null;
          lastError: string | null;
          createdAt: string;
          updatedAt: string;
          items: Array<{
            clusterName: string;
            normalizedClusterName: string;
            desiredBid: number;
            confirmedBid: number | null;
            itemStatus: string;
            createdAt: string;
            updatedAt: string;
          }>;
        }>;
      }

      const jobIds = jobsResult.rows.map((row) => row.job_id);
      await client.query(
        `
          UPDATE ${this.tableName("wb_cluster_bid_jobs")}
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
          UPDATE ${this.tableName("wb_cluster_bid_job_items")}
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
        desired_bid: string;
        confirmed_bid: string | null;
        item_status: string;
        created_at: string;
        updated_at: string;
      }>(
        `
          SELECT
            job_id,
            cluster_name,
            normalized_cluster_name,
            desired_bid::text AS desired_bid,
            confirmed_bid::text AS confirmed_bid,
            item_status,
            created_at::text AS created_at,
            updated_at::text AS updated_at
          FROM ${this.tableName("wb_cluster_bid_job_items")}
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
        processingPhase: job.processing_phase,
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
            desiredBid: Number(item.desired_bid),
            confirmedBid: this.toNullableNumber(item.confirmed_bid),
            itemStatus: item.item_status,
            createdAt: item.created_at,
            updatedAt: item.updated_at,
          }))
          .filter((item) => Number.isFinite(item.desiredBid)),
      }));
    } catch (error) {
      await this.rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

}
