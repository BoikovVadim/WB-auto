import type { StoredProductAdvertisingSheetSnapshotRecord } from "./wb-clusters.repository.types";
import type {
  StoredProductAdvertisingWorkspaceCampaignRowsRecord,
  StoredProductAdvertisingWorkspaceCampaignRowsRow,
  StoredProductAdvertisingWorkspaceClusterQueriesRecord,
  StoredProductAdvertisingWorkspaceClusterQueriesRow,
  StoredProductAdvertisingWorkspaceSnapshotRecord,
  StoredProductAdvertisingWorkspaceSnapshotRow,
} from "./product-workspace-snapshot.types";
import { WbClustersRepositoryAdvertisingRead } from "./wb-clusters.repository.advertising-read";

export abstract class WbClustersRepositoryWorkspaceSnapshotQueryStorage extends WbClustersRepositoryAdvertisingRead {
  async getStoredProductWorkspaceSnapshot(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
  }): Promise<StoredProductAdvertisingWorkspaceSnapshotRecord | null> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<StoredProductAdvertisingWorkspaceSnapshotRow>(
      `
        SELECT
          nm_id::text AS nm_id,
          start_date::text AS start_date,
          end_date::text AS end_date,
          schema_version,
          payload,
          synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_workspace_snapshots")}
        WHERE
          nm_id = $1
          AND start_date = $2::date
          AND end_date = $3::date
          AND schema_version = $4
        LIMIT 1
      `,
      [input.nmId, input.startDate, input.endDate, input.schemaVersion],
    );

    return this.mapStoredProductWorkspaceSnapshotRow(result.rows[0]);
  }

  async getStoredProductWorkspaceCampaignRows(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
    advertId: number;
  }): Promise<StoredProductAdvertisingWorkspaceCampaignRowsRecord | null> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<StoredProductAdvertisingWorkspaceCampaignRowsRow>(
      `
        SELECT
          nm_id::text AS nm_id,
          start_date::text AS start_date,
          end_date::text AS end_date,
          schema_version,
          advert_id::text AS advert_id,
          payload,
          synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_workspace_campaign_rows")}
        WHERE
          nm_id = $1
          AND start_date = $2::date
          AND end_date = $3::date
          AND schema_version = $4
          AND advert_id = $5
        LIMIT 1
      `,
      [input.nmId, input.startDate, input.endDate, input.schemaVersion, input.advertId],
    );

    return this.mapStoredProductWorkspaceCampaignRowsRow(result.rows[0]);
  }

  async getStoredProductWorkspaceClusterQueries(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
    advertId: number;
    clusterKey: string;
  }): Promise<StoredProductAdvertisingWorkspaceClusterQueriesRecord | null> {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query<StoredProductAdvertisingWorkspaceClusterQueriesRow>(
      `
        SELECT
          nm_id::text AS nm_id,
          start_date::text AS start_date,
          end_date::text AS end_date,
          schema_version,
          advert_id::text AS advert_id,
          cluster_key,
          cluster_name,
          payload,
          synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_workspace_cluster_queries")}
        WHERE
          nm_id = $1
          AND start_date = $2::date
          AND end_date = $3::date
          AND schema_version = $4
          AND advert_id = $5
          AND cluster_key = $6
        LIMIT 1
      `,
      [input.nmId, input.startDate, input.endDate, input.schemaVersion, input.advertId, input.clusterKey],
    );

    return this.mapStoredProductWorkspaceClusterQueriesRow(result.rows[0]);
  }

  async listReadyProductAdvertisingSheetSnapshotsMissingWorkspace(limit = 200) {
    await this.ensureSchemaOrThrow();
    const pool = this.getPool();
    const result = await pool.query(
      `
        SELECT
          sheet.nm_id::text AS nm_id,
          sheet.payload,
          sheet.start_date::text AS start_date,
          sheet.end_date::text AS end_date,
          sheet.schema_version,
          sheet.status,
          sheet.built_from_export_request_id,
          sheet.source_kind,
          sheet.ready_at::text AS ready_at,
          sheet.last_attempt_at::text AS last_attempt_at,
          sheet.failure_reason,
          sheet.synced_at::text AS synced_at
        FROM ${this.tableName("wb_product_advertising_sheet_snapshots")} sheet
        LEFT JOIN ${this.tableName("wb_product_workspace_snapshots")} workspace
          ON workspace.nm_id = sheet.nm_id
         AND workspace.start_date = sheet.start_date
         AND workspace.end_date = sheet.end_date
         AND workspace.schema_version = sheet.schema_version
        WHERE sheet.status = 'ready' AND workspace.workspace_key IS NULL
        ORDER BY COALESCE(sheet.ready_at, sheet.synced_at) DESC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows
      .map((row) => this.mapStoredProductAdvertisingSheetSnapshotRow(row))
      .filter((row): row is StoredProductAdvertisingSheetSnapshotRecord => row !== null);
  }

  private mapStoredProductWorkspaceSnapshotRow(
    row: StoredProductAdvertisingWorkspaceSnapshotRow | undefined,
  ): StoredProductAdvertisingWorkspaceSnapshotRecord | null {
    if (!row) {
      return null;
    }

    return {
      nmId: Number(row.nm_id ?? 0),
      startDate: row.start_date,
      endDate: row.end_date,
      schemaVersion: row.schema_version,
      payload: row.payload,
      syncedAt: row.synced_at,
    };
  }

  private mapStoredProductWorkspaceCampaignRowsRow(
    row: StoredProductAdvertisingWorkspaceCampaignRowsRow | undefined,
  ): StoredProductAdvertisingWorkspaceCampaignRowsRecord | null {
    if (!row) {
      return null;
    }

    return {
      nmId: Number(row.nm_id ?? 0),
      startDate: row.start_date,
      endDate: row.end_date,
      schemaVersion: row.schema_version,
      advertId: Number(row.advert_id),
      payload: row.payload,
      syncedAt: row.synced_at,
    };
  }

  private mapStoredProductWorkspaceClusterQueriesRow(
    row: StoredProductAdvertisingWorkspaceClusterQueriesRow | undefined,
  ): StoredProductAdvertisingWorkspaceClusterQueriesRecord | null {
    if (!row) {
      return null;
    }

    return {
      nmId: Number(row.nm_id ?? 0),
      startDate: row.start_date,
      endDate: row.end_date,
      schemaVersion: row.schema_version,
      advertId: Number(row.advert_id),
      clusterKey: row.cluster_key,
      clusterName: row.cluster_name,
      payload: row.payload,
      syncedAt: row.synced_at,
    };
  }
}
