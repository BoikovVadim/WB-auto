import { WbClustersRepositoryBidJobLifecycle } from "./wb-clusters.repository.bid-job-lifecycle";

export abstract class WbClustersRepositoryBidJobResolution extends WbClustersRepositoryBidJobLifecycle {
  async completeClusterBidJobs(jobIds: string[]) {
    if (jobIds.length === 0) {
      return;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    await pool.query(
      `
        UPDATE ${this.tableName("wb_cluster_bid_jobs")}
        SET
          status = 'succeeded',
          last_error = NULL,
          updated_at = NOW()
        WHERE job_id = ANY($1::text[])
      `,
      [jobIds],
    );
    await pool.query(
      `
        UPDATE ${this.tableName("wb_cluster_bid_job_items")}
        SET
          item_status = 'confirmed',
          updated_at = NOW()
        WHERE job_id = ANY($1::text[])
      `,
      [jobIds],
    );
  }

  async rescheduleClusterBidJobs(
    jobIds: string[],
    input: {
      nextAttemptAt: string;
      lastError: string;
      processingPhase?: "write" | "reconcile";
      itemStatus?: "retry_scheduled" | "running" | "confirmed";
    },
  ) {
    if (jobIds.length === 0) {
      return;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    await pool.query(
      `
        UPDATE ${this.tableName("wb_cluster_bid_jobs")}
        SET
          status = 'retry_scheduled',
          next_attempt_at = $2,
          last_error = $3,
          processing_phase = $4,
          updated_at = NOW()
        WHERE job_id = ANY($1::text[])
      `,
      [jobIds, input.nextAttemptAt, input.lastError, input.processingPhase ?? "write"],
    );
    await pool.query(
      `
        UPDATE ${this.tableName("wb_cluster_bid_job_items")}
        SET
          item_status = $2,
          updated_at = NOW()
        WHERE job_id = ANY($1::text[])
      `,
      [jobIds, input.itemStatus ?? "retry_scheduled"],
    );
  }

  async failClusterBidJobs(jobIds: string[], lastError: string) {
    if (jobIds.length === 0) {
      return;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    await pool.query(
      `
        UPDATE ${this.tableName("wb_cluster_bid_jobs")}
        SET
          status = 'failed',
          last_error = $2,
          updated_at = NOW()
        WHERE job_id = ANY($1::text[])
      `,
      [jobIds, lastError],
    );
    await pool.query(
      `
        UPDATE ${this.tableName("wb_cluster_bid_job_items")}
        SET
          item_status = 'failed',
          updated_at = NOW()
        WHERE job_id = ANY($1::text[])
      `,
      [jobIds],
    );
  }

  async failActiveClusterBidReconcileJobs(lastError: string) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const jobsResult = await pool.query<{
      job_id: string;
    }>(
      `
        SELECT job_id
        FROM ${this.tableName("wb_cluster_bid_jobs")}
        WHERE processing_phase = 'reconcile'
          AND status IN ('queued', 'running', 'retry_scheduled')
      `,
    );

    const jobIds = jobsResult.rows.map((row) => row.job_id);
    if (jobIds.length === 0) {
      return 0;
    }

    await this.failClusterBidJobs(jobIds, lastError);
    return jobIds.length;
  }

}
