import type {
  PreferredProductAdvertisingSnapshotSummaryRecord,
  PreferredProductAdvertisingSnapshotSummaryRow,
  ProductAdvertisingSnapshotSummaryRecord,
  ProductAdvertisingSnapshotSummaryRow,
} from "./wb-clusters.repository.types";
import { WbClustersRepositoryJobPersistence } from "./wb-clusters.repository.job-persistence";
export abstract class WbClustersRepositorySnapshotSummaries extends WbClustersRepositoryJobPersistence {
  async getExactReadyProductAdvertisingSnapshotSummaries(input: {
    nmIds: number[];
    startDate: string;
    endDate: string;
    schemaVersion: number;
  }) {
    if (input.nmIds.length === 0) {
      return [] as ProductAdvertisingSnapshotSummaryRecord[];
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<ProductAdvertisingSnapshotSummaryRow>(
      `
        SELECT DISTINCT ON (nm_id)
          nm_id::text AS nm_id,
          start_date::text AS start_date,
          end_date::text AS end_date,
          schema_version,
          status,
          built_from_export_request_id,
          ready_at::text AS ready_at,
          failure_reason,
          synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_advertising_sheet_snapshots")}
        WHERE
          nm_id = ANY($1::bigint[])
          AND start_date = $2::date
          AND end_date = $3::date
          AND schema_version = $4
          AND status = 'ready'
        ORDER BY nm_id, COALESCE(ready_at, synced_at) DESC
      `,
      [input.nmIds, input.startDate, input.endDate, input.schemaVersion],
    );

    return result.rows
      .map((row) => this.mapProductAdvertisingSnapshotSummaryRow(row))
      .filter((row): row is ProductAdvertisingSnapshotSummaryRecord => row !== null);
  }

  async getLatestReadyProductAdvertisingSnapshotSummariesForRange(input: {
    nmIds: number[];
    startDate: string;
    endDate: string;
  }) {
    if (input.nmIds.length === 0) {
      return [] as ProductAdvertisingSnapshotSummaryRecord[];
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<ProductAdvertisingSnapshotSummaryRow>(
      `
        SELECT DISTINCT ON (nm_id)
          nm_id::text AS nm_id,
          start_date::text AS start_date,
          end_date::text AS end_date,
          schema_version,
          status,
          built_from_export_request_id,
          ready_at::text AS ready_at,
          failure_reason,
          synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_advertising_sheet_snapshots")}
        WHERE
          nm_id = ANY($1::bigint[])
          AND start_date = $2::date
          AND end_date = $3::date
          AND status = 'ready'
        ORDER BY nm_id, schema_version DESC, COALESCE(ready_at, synced_at) DESC
      `,
      [input.nmIds, input.startDate, input.endDate],
    );

    return result.rows
      .map((row) => this.mapProductAdvertisingSnapshotSummaryRow(row))
      .filter((row): row is ProductAdvertisingSnapshotSummaryRecord => row !== null);
  }

  async getMostRecentReadyProductAdvertisingSnapshotSummaries(nmIds: number[]) {
    if (nmIds.length === 0) {
      return [] as ProductAdvertisingSnapshotSummaryRecord[];
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<ProductAdvertisingSnapshotSummaryRow>(
      `
        SELECT DISTINCT ON (nm_id)
          nm_id::text AS nm_id,
          start_date::text AS start_date,
          end_date::text AS end_date,
          schema_version,
          status,
          built_from_export_request_id,
          ready_at::text AS ready_at,
          failure_reason,
          synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_advertising_sheet_snapshots")}
        WHERE
          nm_id = ANY($1::bigint[])
          AND status = 'ready'
        ORDER BY nm_id, schema_version DESC, COALESCE(ready_at, synced_at) DESC
      `,
      [nmIds],
    );

    return result.rows
      .map((row) => this.mapProductAdvertisingSnapshotSummaryRow(row))
      .filter((row): row is ProductAdvertisingSnapshotSummaryRecord => row !== null);
  }

  async getClosestReadyProductAdvertisingSnapshotSummariesForRange(input: {
    nmIds: number[];
    startDate: string;
    endDate: string;
  }) {
    if (input.nmIds.length === 0) {
      return [] as ProductAdvertisingSnapshotSummaryRecord[];
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<ProductAdvertisingSnapshotSummaryRow>(
      `
        SELECT DISTINCT ON (nm_id)
          nm_id::text AS nm_id,
          start_date::text AS start_date,
          end_date::text AS end_date,
          schema_version,
          status,
          built_from_export_request_id,
          ready_at::text AS ready_at,
          failure_reason,
          synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_advertising_sheet_snapshots")}
        WHERE
          nm_id = ANY($1::bigint[])
          AND status = 'ready'
        ORDER BY
          nm_id,
          CASE
            WHEN start_date = $2::date AND end_date = $3::date THEN 0
            WHEN start_date <= $2::date AND end_date >= $3::date THEN 1
            WHEN start_date <= $3::date AND end_date >= $2::date THEN 2
            ELSE 3
          END ASC,
          (ABS(start_date - $2::date) + ABS(end_date - $3::date)) ASC,
          schema_version DESC,
          COALESCE(ready_at, synced_at) DESC
      `,
      [input.nmIds, input.startDate, input.endDate],
    );

    return result.rows
      .map((row) => this.mapProductAdvertisingSnapshotSummaryRow(row))
      .filter((row): row is ProductAdvertisingSnapshotSummaryRecord => row !== null);
  }

  async getPreferredReadyProductAdvertisingSnapshotSummariesForRange(input: {
    nmIds: number[];
    startDate: string;
    endDate: string;
    schemaVersion: number;
  }) {
    if (input.nmIds.length === 0) {
      return [] as PreferredProductAdvertisingSnapshotSummaryRecord[];
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<PreferredProductAdvertisingSnapshotSummaryRow>(
      `
        WITH ranked_snapshots AS (
          SELECT
            nm_id::text AS nm_id,
            start_date::text AS start_date,
            end_date::text AS end_date,
            schema_version,
            status,
            built_from_export_request_id,
            ready_at::text AS ready_at,
            failure_reason,
            synced_at::text AS synced_at,
            CASE
              WHEN start_date = $2::date AND end_date = $3::date AND schema_version = $4
                THEN 'exact'
              WHEN start_date = $2::date AND end_date = $3::date
                THEN 'latest_schema'
              WHEN start_date <= $2::date AND end_date >= $3::date
                THEN 'closest_range'
              ELSE 'most_recent'
            END::text AS resolution_fit,
            CASE
              WHEN start_date = $2::date AND end_date = $3::date AND schema_version = $4
                THEN 'exact_snapshot'
              WHEN start_date = $2::date AND end_date = $3::date
                THEN 'latest_schema_snapshot'
              WHEN start_date <= $2::date AND end_date >= $3::date
                THEN 'closest_range_snapshot'
              ELSE 'most_recent_snapshot'
            END::text AS resolution_source,
            ROW_NUMBER() OVER (
              PARTITION BY nm_id
              ORDER BY
                CASE
                  WHEN start_date = $2::date AND end_date = $3::date AND schema_version = $4 THEN 0
                  WHEN start_date = $2::date AND end_date = $3::date THEN 1
                  WHEN start_date <= $2::date AND end_date >= $3::date THEN 2
                  ELSE 3
                END ASC,
                (ABS(start_date - $2::date) + ABS(end_date - $3::date)) ASC,
                schema_version DESC,
                COALESCE(ready_at, synced_at) DESC
            ) AS snapshot_rank
          FROM ${this.tableName("wb_product_advertising_sheet_snapshots")}
          WHERE
            nm_id = ANY($1::bigint[])
            AND status = 'ready'
        )
        SELECT
          nm_id,
          start_date,
          end_date,
          schema_version,
          status,
          built_from_export_request_id,
          ready_at,
          failure_reason,
          synced_at,
          resolution_fit,
          resolution_source
        FROM ranked_snapshots
        WHERE snapshot_rank = 1
      `,
      [input.nmIds, input.startDate, input.endDate, input.schemaVersion],
    );

    return result.rows
      .map((row) => this.mapPreferredProductAdvertisingSnapshotSummaryRow(row))
      .filter((row): row is PreferredProductAdvertisingSnapshotSummaryRecord => row !== null);
  }

}
