import { WbClustersRepositoryActionJobLifecycle } from "./wb-clusters.repository.action-job-lifecycle";

export abstract class WbClustersRepositoryActionJobResolution extends WbClustersRepositoryActionJobLifecycle {
  async completeClusterActionJobs(jobIds: string[]) {
    if (jobIds.length === 0) {
      return;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    await pool.query(
      `
        UPDATE ${this.tableName("wb_cluster_action_jobs")}
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
        UPDATE ${this.tableName("wb_cluster_action_job_items")}
        SET
          item_status = 'confirmed',
          updated_at = NOW()
        WHERE job_id = ANY($1::text[])
      `,
      [jobIds],
    );
  }

  async rescheduleClusterActionJobs(
    jobIds: string[],
    input: {
      nextAttemptAt: string;
      lastError: string;
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
        UPDATE ${this.tableName("wb_cluster_action_jobs")}
        SET
          status = 'retry_scheduled',
          next_attempt_at = $2,
          last_error = $3,
          updated_at = NOW()
        WHERE job_id = ANY($1::text[])
      `,
      [jobIds, input.nextAttemptAt, input.lastError],
    );
    await pool.query(
      `
        UPDATE ${this.tableName("wb_cluster_action_job_items")}
        SET
          item_status = $2,
          updated_at = NOW()
        WHERE job_id = ANY($1::text[])
      `,
      [jobIds, input.itemStatus ?? "retry_scheduled"],
    );
  }

  async failClusterActionJobs(jobIds: string[], lastError: string) {
    if (jobIds.length === 0) {
      return;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    await pool.query(
      `
        UPDATE ${this.tableName("wb_cluster_action_jobs")}
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
        UPDATE ${this.tableName("wb_cluster_action_job_items")}
        SET
          item_status = 'failed',
          updated_at = NOW()
        WHERE job_id = ANY($1::text[])
      `,
      [jobIds],
    );
  }

}
