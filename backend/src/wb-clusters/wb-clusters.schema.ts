import type { Pool } from "pg";

import {
  getCabinetQueryMapDeduplicationStatements,
  getCampaignAlterStatements,
  getCampaignProductAlterStatements,
  getCatalogAlterStatements,
  getChangeLogCreateStatements,
  getCostPriceCreateStatements,
  getProductBuyoutDailySnapshotAlterStatements,
  getProductBuyoutDailySnapshotCreateStatements,
  getProductCostSumDailySnapshotCreateStatements,
  getProductDailyOrdersCreateStatements,
  getProductDailyPricesCreateStatements,
  getProductPriceChangesCreateStatements,
  getProductDailyReturnsCreateStatements,
  getProductSppDailyCreateStatements,
  getProductDailyStocksCreateStatements,
  getSystemChangeLogCreateStatements,
  getClusterKeyMigrationStatements,
  getClusterStatsAlterStatements,
  getClusterWriteAlterStatements,
  getClusterWriteBackfillStatements,
  getMonthlyFrequencyAlterStatements,
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
import { getProductAcquiringWeeklyCreateStatements } from "./wb-clusters.schema.acquiring";
import { getIndexStatements } from "./wb-clusters.schema.indexes";
import { getUnitEconomicsSettingsCreateStatements } from "./wb-clusters.schema.unit-economics";
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
  await executeSchemaStatements(context, getCampaignAlterStatements(context));
  await executeSchemaStatements(context, getCampaignProductAlterStatements(context));
  await executeSchemaStatements(context, getClusterCoreCreateStatements(context));
  await executeSchemaStatements(context, getClusterKeyMigrationStatements(context));
  await executeSchemaStatements(context, getClusterStatsAlterStatements(context));
  await executeSchemaStatements(context, getClusterQueueCreateStatements(context));
  await executeSchemaStatements(context, getClusterWriteAlterStatements(context));
  await executeSchemaStatements(context, getClusterWriteBackfillStatements(context));
  await executeSchemaStatements(context, getReadModelCreateStatements(context));
  await executeSchemaStatements(context, getMonthlyFrequencyAlterStatements(context));
  await executeSchemaStatements(context, getSnapshotAlterStatements(context));
  await executeSchemaStatements(context, getArchiveCreateStatements(context));
  await executeSchemaStatements(context, getIndexStatements(context));
  await executeSchemaStatements(context, getCabinetQueryMapDeduplicationStatements(context));
  await executeSchemaStatements(context, getChangeLogCreateStatements(context));
  await executeSchemaStatements(context, getCostPriceCreateStatements(context));
  await executeSchemaStatements(context, getSystemChangeLogCreateStatements(context));
  await executeSchemaStatements(context, getProductDailyOrdersCreateStatements(context));
  await executeSchemaStatements(context, getProductDailyReturnsCreateStatements(context));
  await executeSchemaStatements(context, getProductBuyoutDailySnapshotCreateStatements(context));
  await executeSchemaStatements(context, getProductBuyoutDailySnapshotAlterStatements(context));
  await executeSchemaStatements(context, getProductCostSumDailySnapshotCreateStatements(context));
  await executeSchemaStatements(context, getProductSppDailyCreateStatements(context));
  await executeSchemaStatements(context, getProductDailyStocksCreateStatements(context));
  await executeSchemaStatements(context, getProductDailyPricesCreateStatements(context));
  await executeSchemaStatements(context, getProductPriceChangesCreateStatements(context));
  await executeSchemaStatements(context, getProductAcquiringWeeklyCreateStatements(context));
  await executeSchemaStatements(context, getUnitEconomicsSettingsCreateStatements(context));
}
