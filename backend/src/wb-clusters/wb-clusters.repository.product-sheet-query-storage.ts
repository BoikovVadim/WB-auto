import type {
  StoredProductAdvertisingSheetSnapshotRecord,
  StoredProductAdvertisingSheetSnapshotRow,
} from "./wb-clusters.repository.types";
import { WbClustersRepositorySearchTextStorage } from "./wb-clusters.repository.search-text-storage";

export abstract class WbClustersRepositoryProductSheetQueryStorage extends WbClustersRepositorySearchTextStorage {
  async getStoredProductAdvertisingSheetSnapshotsByKeys(
    input: Array<{
      nmId: number;
      startDate: string;
      endDate: string;
      schemaVersion: number;
    }>,
  ) {
    if (input.length === 0) {
      return [] as StoredProductAdvertisingSheetSnapshotRecord[];
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const valuesSql = input
      .map((_, index) => {
        const baseOffset = index * 4;
        return `($${baseOffset + 1}::bigint, $${baseOffset + 2}::date, $${baseOffset + 3}::date, $${baseOffset + 4}::integer)`;
      })
      .join(", ");
    const values = input.flatMap((item) => [
      item.nmId,
      item.startDate,
      item.endDate,
      item.schemaVersion,
    ]);
    const result = await pool.query<StoredProductAdvertisingSheetSnapshotRow & { nm_id: string }>(
      `
        WITH requested_snapshots(nm_id, start_date, end_date, schema_version) AS (
          VALUES ${valuesSql}
        )
        SELECT
          snapshot.nm_id::text AS nm_id,
          snapshot.payload,
          snapshot.start_date::text AS start_date,
          snapshot.end_date::text AS end_date,
          snapshot.schema_version,
          snapshot.status,
          snapshot.built_from_export_request_id,
          snapshot.source_kind,
          snapshot.ready_at::text AS ready_at,
          snapshot.last_attempt_at::text AS last_attempt_at,
          snapshot.failure_reason,
          snapshot.synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_advertising_sheet_snapshots")} snapshot
        JOIN requested_snapshots requested
          ON requested.nm_id = snapshot.nm_id
         AND requested.start_date = snapshot.start_date
         AND requested.end_date = snapshot.end_date
         AND requested.schema_version = snapshot.schema_version
        WHERE snapshot.status = 'ready'
      `,
      values,
    );

    return result.rows
      .map((row) => this.mapStoredProductAdvertisingSheetSnapshotRow(row))
      .filter((row): row is StoredProductAdvertisingSheetSnapshotRecord => row !== null);
  }

  async listReadyProductAdvertisingSheetSnapshotsMissingSchemaVersion(
    schemaVersion: number,
    limit = 200,
  ) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query(
      `
        SELECT
          snapshot.nm_id::text AS nm_id,
          snapshot.payload,
          snapshot.start_date::text AS start_date,
          snapshot.end_date::text AS end_date,
          snapshot.schema_version,
          snapshot.status,
          snapshot.built_from_export_request_id,
          snapshot.source_kind,
          snapshot.ready_at::text AS ready_at,
          snapshot.last_attempt_at::text AS last_attempt_at,
          snapshot.failure_reason,
          snapshot.synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_advertising_sheet_snapshots")} snapshot
        LEFT JOIN ${this.tableName("wb_product_advertising_sheet_snapshots")} current_schema_snapshot
          ON current_schema_snapshot.nm_id = snapshot.nm_id
         AND current_schema_snapshot.start_date = snapshot.start_date
         AND current_schema_snapshot.end_date = snapshot.end_date
         AND current_schema_snapshot.schema_version = $1
         AND current_schema_snapshot.status = 'ready'
        WHERE
          snapshot.status = 'ready'
          AND snapshot.schema_version <> $1
          AND current_schema_snapshot.snapshot_key IS NULL
        ORDER BY COALESCE(snapshot.ready_at, snapshot.synced_at) DESC
        LIMIT $2
      `,
      [schemaVersion, limit],
    );

    return result.rows
      .map((row) => this.mapStoredProductAdvertisingSheetSnapshotRow(row))
      .filter((row): row is StoredProductAdvertisingSheetSnapshotRecord => row !== null);
  }

  async getStoredProductAdvertisingSheetSnapshot(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
  }): Promise<StoredProductAdvertisingSheetSnapshotRecord | null> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<StoredProductAdvertisingSheetSnapshotRow>(
      `
        SELECT
          payload,
          start_date::text AS start_date,
          end_date::text AS end_date,
          schema_version,
          status,
          built_from_export_request_id,
          source_kind,
          ready_at::text AS ready_at,
          last_attempt_at::text AS last_attempt_at,
          failure_reason,
          synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_advertising_sheet_snapshots")}
        WHERE
          nm_id = $1
          AND start_date = $2::date
          AND end_date = $3::date
          AND schema_version = $4
          AND status = 'ready'
        ORDER BY COALESCE(ready_at, synced_at) DESC
        LIMIT 1
      `,
      [input.nmId, input.startDate, input.endDate, input.schemaVersion],
    );

    return this.mapStoredProductAdvertisingSheetSnapshotRow(result.rows[0]);
  }

  async getLatestStoredProductAdvertisingSheetSnapshot(input: {
    nmId: number;
    startDate: string;
    endDate: string;
  }): Promise<StoredProductAdvertisingSheetSnapshotRecord | null> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<StoredProductAdvertisingSheetSnapshotRow>(
      `
        SELECT
          payload,
          start_date::text AS start_date,
          end_date::text AS end_date,
          schema_version,
          status,
          built_from_export_request_id,
          source_kind,
          ready_at::text AS ready_at,
          last_attempt_at::text AS last_attempt_at,
          failure_reason,
          synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_advertising_sheet_snapshots")}
        WHERE
          nm_id = $1
          AND start_date = $2::date
          AND end_date = $3::date
          AND status = 'ready'
        ORDER BY schema_version DESC, COALESCE(ready_at, synced_at) DESC
        LIMIT 1
      `,
      [input.nmId, input.startDate, input.endDate],
    );

    return this.mapStoredProductAdvertisingSheetSnapshotRow(result.rows[0]);
  }

  async getMostRecentStoredProductAdvertisingSheetSnapshot(
    nmId: number,
  ): Promise<StoredProductAdvertisingSheetSnapshotRecord | null> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<StoredProductAdvertisingSheetSnapshotRow>(
      `
        SELECT
          payload,
          start_date::text AS start_date,
          end_date::text AS end_date,
          schema_version,
          status,
          built_from_export_request_id,
          source_kind,
          ready_at::text AS ready_at,
          last_attempt_at::text AS last_attempt_at,
          failure_reason,
          synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_advertising_sheet_snapshots")}
        WHERE nm_id = $1
          AND status = 'ready'
        ORDER BY schema_version DESC, COALESCE(ready_at, synced_at) DESC
        LIMIT 1
      `,
      [nmId],
    );

    return this.mapStoredProductAdvertisingSheetSnapshotRow(result.rows[0]);
  }

  async getClosestStoredProductAdvertisingSheetSnapshotForRange(input: {
    nmId: number;
    startDate: string;
    endDate: string;
  }): Promise<StoredProductAdvertisingSheetSnapshotRecord | null> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<StoredProductAdvertisingSheetSnapshotRow>(
      `
        SELECT
          payload,
          start_date::text AS start_date,
          end_date::text AS end_date,
          schema_version,
          status,
          built_from_export_request_id,
          source_kind,
          ready_at::text AS ready_at,
          last_attempt_at::text AS last_attempt_at,
          failure_reason,
          synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_advertising_sheet_snapshots")}
        WHERE
          nm_id = $1
          AND status = 'ready'
        ORDER BY
          CASE
            WHEN start_date = $2::date AND end_date = $3::date THEN 0
            WHEN start_date <= $2::date AND end_date >= $3::date THEN 1
            WHEN start_date <= $3::date AND end_date >= $2::date THEN 2
            ELSE 3
          END ASC,
          (ABS(start_date - $2::date) + ABS(end_date - $3::date)) ASC,
          schema_version DESC,
          COALESCE(ready_at, synced_at) DESC
        LIMIT 1
      `,
      [input.nmId, input.startDate, input.endDate],
    );

    return this.mapStoredProductAdvertisingSheetSnapshotRow(result.rows[0]);
  }

}
