import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

export function getArchiveCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_raw_archive")} (
        id TEXT PRIMARY KEY,
        sync_run_id TEXT NOT NULL REFERENCES ${tableName("wb_cluster_sync_runs")}(id) ON DELETE CASCADE,
        archive_type TEXT NOT NULL,
        advert_id BIGINT NULL,
        nm_id BIGINT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
  ];
}

