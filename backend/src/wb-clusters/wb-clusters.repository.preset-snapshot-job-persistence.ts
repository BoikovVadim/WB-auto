import { randomUUID } from "node:crypto";

import type {
  ProductPresetSnapshotJobStatus,
} from "./wb-clusters.types";
import type {
  ProductPresetSnapshotJobRecord,
  ProductPresetSnapshotJobRecordSummary,
} from "./wb-clusters.repository.types";
import { WbClustersRepositoryActionJobPersistence } from "./wb-clusters.repository.action-job-persistence";
export abstract class WbClustersRepositoryPresetSnapshotJobPersistence extends WbClustersRepositoryActionJobPersistence {
  async createOrUpdateProductPresetSnapshotJob(input: {
    sourceExportRequestId: string;
    startDate: string;
    endDate: string;
    nmIds: number[];
    reason: string;
    allowSucceededRequeue?: boolean;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const jobId = `preset-snapshot-job-${Date.now()}-${randomUUID()}`;
    const queuedAt = new Date().toISOString();
    const normalizedNmIds = Array.from(
      new Set(input.nmIds.filter((value) => Number.isInteger(value) && value > 0)),
    );
    const result = await pool.query<{
      job_id: string;
      status: ProductPresetSnapshotJobStatus;
      next_attempt_at: string;
    }>(
      `
        INSERT INTO ${this.tableName("wb_product_preset_snapshot_jobs")} (
          job_id,
          source_export_request_id,
          requested_start_date,
          requested_end_date,
          status,
          attempt_count,
          next_attempt_at,
          reason,
          nm_ids_json,
          created_at,
          updated_at
        ) VALUES ($1,$2,$3::date,$4::date,'queued',0,$5,$6,$7::jsonb,$5,$5)
        ON CONFLICT (source_export_request_id, requested_start_date, requested_end_date)
        DO UPDATE SET
          nm_ids_json = EXCLUDED.nm_ids_json,
          reason = EXCLUDED.reason,
          status = CASE
            WHEN ${this.tableName("wb_product_preset_snapshot_jobs")}.status = 'succeeded'
              AND NOT $8::boolean
              THEN ${this.tableName("wb_product_preset_snapshot_jobs")}.status
            WHEN ${this.tableName("wb_product_preset_snapshot_jobs")}.status = 'running'
              THEN ${this.tableName("wb_product_preset_snapshot_jobs")}.status
            ELSE 'queued'
          END,
          next_attempt_at = CASE
            WHEN ${this.tableName("wb_product_preset_snapshot_jobs")}.status = 'succeeded'
              AND NOT $8::boolean
              THEN ${this.tableName("wb_product_preset_snapshot_jobs")}.next_attempt_at
            WHEN ${this.tableName("wb_product_preset_snapshot_jobs")}.status = 'running'
              THEN ${this.tableName("wb_product_preset_snapshot_jobs")}.next_attempt_at
            ELSE EXCLUDED.next_attempt_at
          END,
          updated_at = EXCLUDED.updated_at
        RETURNING job_id, status, next_attempt_at::text AS next_attempt_at
      `,
      [
        jobId,
        input.sourceExportRequestId,
        input.startDate,
        input.endDate,
        queuedAt,
        input.reason,
        JSON.stringify(normalizedNmIds),
        input.allowSucceededRequeue ?? false,
      ],
    );
    return {
      jobId: result.rows[0]?.job_id ?? jobId,
      status: result.rows[0]?.status ?? "queued",
      nextAttemptAt: result.rows[0]?.next_attempt_at ?? queuedAt,
    };
  }

  async getProductPresetSnapshotJob(input: {
    sourceExportRequestId: string;
    startDate: string;
    endDate: string;
  }): Promise<ProductPresetSnapshotJobRecordSummary | null> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<ProductPresetSnapshotJobRecord>(
      `
        SELECT
          job_id,
          source_export_request_id,
          preset_export_request_id,
          requested_start_date::text AS requested_start_date,
          requested_end_date::text AS requested_end_date,
          status,
          attempt_count,
          next_attempt_at::text AS next_attempt_at,
          last_attempt_at::text AS last_attempt_at,
          last_error,
          reason,
          COALESCE(
            ARRAY(
              SELECT jsonb_array_elements_text(nm_ids_json)::bigint::int
            ),
            ARRAY[]::int[]
          ) AS nm_ids_json,
          created_at::text AS created_at,
          updated_at::text AS updated_at
        FROM ${this.tableName("wb_product_preset_snapshot_jobs")}
        WHERE
          source_export_request_id = $1
          AND requested_start_date = $2::date
          AND requested_end_date = $3::date
        LIMIT 1
      `,
      [input.sourceExportRequestId, input.startDate, input.endDate],
    );

    return this.mapProductPresetSnapshotJobRow(result.rows[0] ?? null);
  }

  async startProductPresetSnapshotJob(jobId: string) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<{ job_id: string }>(
      `
        UPDATE ${this.tableName("wb_product_preset_snapshot_jobs")}
        SET
          status = 'running',
          attempt_count = attempt_count + 1,
          last_attempt_at = NOW(),
          updated_at = NOW()
        WHERE
          job_id = $1
          AND status IN ('queued', 'retry_scheduled')
        RETURNING job_id
      `,
      [jobId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async claimReadyProductPresetSnapshotJobs(limit: number) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const jobsResult = await client.query<ProductPresetSnapshotJobRecord>(
        `
          SELECT
            job_id,
            source_export_request_id,
            preset_export_request_id,
            requested_start_date::text AS requested_start_date,
            requested_end_date::text AS requested_end_date,
            status,
            attempt_count,
            next_attempt_at::text AS next_attempt_at,
            last_attempt_at::text AS last_attempt_at,
            last_error,
            reason,
            COALESCE(
              ARRAY(
                SELECT jsonb_array_elements_text(nm_ids_json)::bigint::int
              ),
              ARRAY[]::int[]
            ) AS nm_ids_json,
            created_at::text AS created_at,
            updated_at::text AS updated_at
          FROM ${this.tableName("wb_product_preset_snapshot_jobs")}
          WHERE (
            (
              status IN ('queued', 'retry_scheduled')
              AND next_attempt_at <= NOW()
            )
            OR (
              status = 'running'
              AND COALESCE(last_attempt_at, created_at) <= NOW() - INTERVAL '10 minutes'
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
          sourceExportRequestId: string;
          presetExportRequestId: string | null;
          startDate: string;
          endDate: string;
          status: ProductPresetSnapshotJobStatus;
          attemptCount: number;
          reason: string | null;
          nmIds: number[];
        }>;
      }

      const jobIds = jobsResult.rows.map((row) => row.job_id);
      await client.query(
        `
          UPDATE ${this.tableName("wb_product_preset_snapshot_jobs")}
          SET
            status = 'running',
            attempt_count = attempt_count + 1,
            last_attempt_at = NOW(),
            updated_at = NOW()
          WHERE job_id = ANY($1::text[])
        `,
        [jobIds],
      );
      await client.query("COMMIT");

      return jobsResult.rows.map((row) => ({
        jobId: row.job_id,
        sourceExportRequestId: row.source_export_request_id,
        presetExportRequestId: row.preset_export_request_id,
        startDate: row.requested_start_date,
        endDate: row.requested_end_date,
        status: "running" as const,
        attemptCount: row.attempt_count + 1,
        reason: row.reason,
        nmIds: row.nm_ids_json,
      }));
    } catch (error) {
      await this.rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async succeedProductPresetSnapshotJob(jobId: string, presetExportRequestId: string) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    await pool.query(
      `
        UPDATE ${this.tableName("wb_product_preset_snapshot_jobs")}
        SET
          status = 'succeeded',
          preset_export_request_id = $2,
          last_error = NULL,
          updated_at = NOW()
        WHERE job_id = $1
      `,
      [jobId, presetExportRequestId],
    );
  }

  async rescheduleProductPresetSnapshotJob(
    jobId: string,
    input: { nextAttemptAt: string; lastError: string },
  ) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    await pool.query(
      `
        UPDATE ${this.tableName("wb_product_preset_snapshot_jobs")}
        SET
          status = 'retry_scheduled',
          next_attempt_at = $2,
          last_error = $3,
          updated_at = NOW()
        WHERE job_id = $1
      `,
      [jobId, input.nextAttemptAt, input.lastError],
    );
  }

  async failProductPresetSnapshotJob(jobId: string, lastError: string) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    await pool.query(
      `
        UPDATE ${this.tableName("wb_product_preset_snapshot_jobs")}
        SET
          status = 'failed',
          last_error = $2,
          updated_at = NOW()
        WHERE job_id = $1
      `,
      [jobId, lastError],
    );
  }

}
