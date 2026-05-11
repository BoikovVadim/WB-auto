import type { Pool } from "pg";

import {
  getCampaignProductAlterStatements,
  getCatalogAlterStatements,
  getClusterStatsAlterStatements,
  getClusterWriteAlterStatements,
  getClusterWriteBackfillStatements,
  getSnapshotAlterStatements,
  getSyncRunAlterStatements,
} from "./wb-clusters.schema.alter-backfill";
import {
  getArchiveCreateStatements,
  getClusterCoreCreateStatements,
  getClusterQueueCreateStatements,
  getCoreCreateStatements,
  getReadModelCreateStatements,
} from "./wb-clusters.schema.create-statements";
import {
  ensureWbClustersSchema,
  executeSchemaStatements,
} from "./wb-clusters.schema.executor";
import { getIndexStatements } from "./wb-clusters.schema.indexes";
import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

export async function initializeWbClustersSchema(input: {
  pool: Pool;
  schema: string;
  escapeIdentifier: (name: string) => string;
  tableName: (name: string) => string;
}) {
  const context: WbClustersSchemaContext = input;

  await ensureWbClustersSchema(context);
  await executeSchemaStatements(context, getCoreCreateStatements(context));
  await executeSchemaStatements(context, getSyncRunAlterStatements(context));
  await executeSchemaStatements(context, getCatalogAlterStatements(context));
  await executeSchemaStatements(context, getCampaignProductAlterStatements(context));
  await executeSchemaStatements(context, getClusterCoreCreateStatements(context));
  await executeSchemaStatements(context, getClusterStatsAlterStatements(context));
  await executeSchemaStatements(context, getClusterQueueCreateStatements(context));
  await executeSchemaStatements(context, getClusterWriteAlterStatements(context));
  await executeSchemaStatements(context, getClusterWriteBackfillStatements(context));
  await executeSchemaStatements(context, getReadModelCreateStatements(context));
  await executeSchemaStatements(context, getSnapshotAlterStatements(context));
  await executeSchemaStatements(context, getArchiveCreateStatements(context));
  await executeSchemaStatements(context, getIndexStatements(context));
}
