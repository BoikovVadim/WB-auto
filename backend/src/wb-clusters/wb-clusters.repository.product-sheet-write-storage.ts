import type { ProductAdvertisingSheetResponse } from "./wb-clusters.types";
import { WbClustersRepositoryProductSheetQueryStorage } from "./wb-clusters.repository.product-sheet-query-storage";

export abstract class WbClustersRepositoryProductSheetWriteStorage extends WbClustersRepositoryProductSheetQueryStorage {
  async replaceStoredProductAdvertisingSheetSnapshot(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
    payload: ProductAdvertisingSheetResponse;
    status?: "ready" | "building" | "failed";
    builtFromExportRequestId?: string | null;
    sourceKind?: string;
    readyAt?: string | null;
    lastAttemptAt?: string | null;
    failureReason?: string | null;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    await pool.query(
      `
        INSERT INTO ${this.tableName("wb_product_advertising_sheet_snapshots")} (
          snapshot_key,
          nm_id,
          start_date,
          end_date,
          schema_version,
          payload,
          status,
          built_from_export_request_id,
          source_kind,
          ready_at,
          last_attempt_at,
          failure_reason,
          synced_at
        ) VALUES ($1, $2, $3::date, $4::date, $5, $6::jsonb, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, NOW())
        ON CONFLICT (nm_id, start_date, end_date, schema_version)
        DO UPDATE SET
          snapshot_key = EXCLUDED.snapshot_key,
          payload = EXCLUDED.payload,
          status = EXCLUDED.status,
          built_from_export_request_id = EXCLUDED.built_from_export_request_id,
          source_kind = EXCLUDED.source_kind,
          ready_at = EXCLUDED.ready_at,
          last_attempt_at = EXCLUDED.last_attempt_at,
          failure_reason = EXCLUDED.failure_reason,
          synced_at = NOW()
      `,
      [
        this.buildProductAdvertisingSheetSnapshotStorageKey(
          input.nmId,
          input.startDate,
          input.endDate,
          input.schemaVersion,
        ),
        input.nmId,
        input.startDate,
        input.endDate,
        input.schemaVersion,
        JSON.stringify(input.payload),
        input.status ?? "ready",
        input.builtFromExportRequestId ?? null,
        input.sourceKind ?? "materialized",
        input.readyAt ?? null,
        input.lastAttemptAt ?? null,
        input.failureReason ?? null,
      ],
    );
  }

  async deleteStoredProductAdvertisingSheetSnapshotsForNmIds(
    nmIds: number[],
    schemaVersion?: number,
  ) {
    if (nmIds.length === 0) {
      return;
    }

    await this.ensureSchemaOrThrow();
    const pool = this.getPool();

    if (typeof schemaVersion === "number") {
      await pool.query(
        `
          DELETE FROM ${this.tableName("wb_product_advertising_sheet_snapshots")}
          WHERE nm_id = ANY($1::bigint[]) AND schema_version = $2
        `,
        [nmIds, schemaVersion],
      );
      return;
    }

    await pool.query(
      `
        DELETE FROM ${this.tableName("wb_product_advertising_sheet_snapshots")}
        WHERE nm_id = ANY($1::bigint[])
      `,
      [nmIds],
    );
  }

  async deleteStoredProductAdvertisingSheetSnapshot(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
  }) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    await pool.query(
      `
        DELETE FROM ${this.tableName("wb_product_advertising_sheet_snapshots")}
        WHERE
          nm_id = $1
          AND start_date = $2::date
          AND end_date = $3::date
          AND schema_version = $4
      `,
      [input.nmId, input.startDate, input.endDate, input.schemaVersion],
    );
  }

}
