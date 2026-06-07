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
import { getClusterPositionSnapshotCreateStatements } from "./wb-clusters.schema.positions";
import { getIndexStatements } from "./wb-clusters.schema.indexes";
import {
  getUnitEconomicsMarginSnapshotCreateStatements,
  getUnitEconomicsSettingsCreateStatements,
} from "./wb-clusters.schema.unit-economics";
import { getClusterAutomationCreateStatements } from "./wb-clusters.schema.automation";
import { getClusterAccrualCreateStatements } from "./wb-clusters.schema.accrual";
import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

// Версия схемы. ОБЯЗАТЕЛЬНО увеличивай на +1 при ЛЮБОМ изменении набора
// DDL/backfill ниже (новая таблица/колонка/индекс/миграция/backfill, либо правка
// существующего стейтмента). Version-gate ниже пропускает весь блок инициализации,
// если в БД уже записана эта версия — поэтому без бампа изменения НЕ применятся на
// прод-БД, где версия уже стоит.
//
// История:
//   1 — внедрение version-gate (исходный набор схемы на момент внедрения).
//   2 — wb_cluster_change_log.initiated_by (user/automation) для истории изменений.
//   3 — модерация новых кластеров: review_status в state + baselined_at в campaign_automation.
//   4 — wb_cluster_position_snapshots: место товара в выдаче по кластеру на момент замера.
//   5 — wb_cluster_position_snapshots.display_position: органика С рекламой (3 метрики позиции).
//   6 — wb_cluster_accrual: накопительные счётчики кластера по ценовым корзинам (фаза LEARNING + регулятор ДРР).
const CURRENT_SCHEMA_VERSION = 6;

const SCHEMA_META_TABLE = "wb_clusters_schema_meta";

async function readInstalledSchemaVersion(
  context: WbClustersSchemaContext,
): Promise<number | null> {
  await context.pool.query(
    `
      CREATE TABLE IF NOT EXISTS ${context.tableName(SCHEMA_META_TABLE)} (
        id INT PRIMARY KEY DEFAULT 1,
        version INT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ${context.escapeIdentifier(`${SCHEMA_META_TABLE}_singleton`)} CHECK (id = 1)
      )
    `,
  );
  const result = await context.pool.query<{ version: number }>(
    `SELECT version FROM ${context.tableName(SCHEMA_META_TABLE)} WHERE id = 1`,
  );
  return result.rows[0]?.version ?? null;
}

async function writeInstalledSchemaVersion(
  context: WbClustersSchemaContext,
  version: number,
) {
  await context.pool.query(
    `
      INSERT INTO ${context.tableName(SCHEMA_META_TABLE)} (id, version, updated_at)
      VALUES (1, $1, NOW())
      ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, updated_at = NOW()
    `,
    [version],
  );
}

export async function initializeWbClustersSchema(input: {
  pool: Pool;
  schema: string;
  escapeIdentifier: (name: string) => string;
  tableName: (name: string) => string;
}) {
  const context: WbClustersSchemaContext = input;

  await ensureWbClustersSchema(context);

  // Version-gate: при уже актуальной версии схемы пропускаем весь DDL + backfill.
  // Раньше каждый старт прогонял ~90с DDL/IF-NOT-EXISTS-проверок и seq-сканов
  // больших таблиц (backfill `WHERE col IS NULL` по 2,5М+ строк), а все read-пути
  // ждут ensureSchema() → дашборд был пуст ~2 минуты после каждого рестарта/деплоя.
  // Все стейтменты ниже идемпотентны, а backfill'ы — одноразовые миграции legacy-строк
  // (текущий write-путь заполняет колонки при вставке), поэтому пропуск при совпадении
  // версии безопасен. После любого изменения схемы — бамп CURRENT_SCHEMA_VERSION.
  const installedVersion = await readInstalledSchemaVersion(context);
  if (installedVersion === CURRENT_SCHEMA_VERSION) {
    return;
  }

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
  await executeSchemaStatements(context, getClusterPositionSnapshotCreateStatements(context));
  await executeSchemaStatements(context, getUnitEconomicsSettingsCreateStatements(context));
  await executeSchemaStatements(context, getUnitEconomicsMarginSnapshotCreateStatements(context));
  await executeSchemaStatements(context, getClusterAutomationCreateStatements(context));
  await executeSchemaStatements(context, getClusterAccrualCreateStatements(context));

  // Фиксируем применённую версию — следующий старт пройдёт version-gate мгновенно.
  await writeInstalledSchemaVersion(context, CURRENT_SCHEMA_VERSION);
}
