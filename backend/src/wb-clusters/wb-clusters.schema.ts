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
//   7 — wb_cluster_automation_state.drr_held: флаг «придержан регулятором дневного ДРР» (excluded_drr).
const CURRENT_SCHEMA_VERSION = 7;

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

  // Все наборы DDL/миграций в порядке применения (CREATE до ALTER до backfill/INDEX).
  const allStatements = [
    ...getCoreCreateStatements(context),
    ...getSyncRunAlterStatements(context),
    ...getCatalogAlterStatements(context),
    ...getCampaignAlterStatements(context),
    ...getCampaignProductAlterStatements(context),
    ...getClusterCoreCreateStatements(context),
    ...getClusterKeyMigrationStatements(context),
    ...getClusterStatsAlterStatements(context),
    ...getClusterQueueCreateStatements(context),
    ...getClusterWriteAlterStatements(context),
    ...getClusterWriteBackfillStatements(context),
    ...getReadModelCreateStatements(context),
    ...getMonthlyFrequencyAlterStatements(context),
    ...getSnapshotAlterStatements(context),
    ...getArchiveCreateStatements(context),
    ...getIndexStatements(context),
    ...getCabinetQueryMapDeduplicationStatements(context),
    ...getChangeLogCreateStatements(context),
    ...getCostPriceCreateStatements(context),
    ...getSystemChangeLogCreateStatements(context),
    ...getProductDailyOrdersCreateStatements(context),
    ...getProductDailyReturnsCreateStatements(context),
    ...getProductBuyoutDailySnapshotCreateStatements(context),
    ...getProductBuyoutDailySnapshotAlterStatements(context),
    ...getProductCostSumDailySnapshotCreateStatements(context),
    ...getProductSppDailyCreateStatements(context),
    ...getProductDailyStocksCreateStatements(context),
    ...getProductDailyPricesCreateStatements(context),
    ...getProductPriceChangesCreateStatements(context),
    ...getProductAcquiringWeeklyCreateStatements(context),
    ...getClusterPositionSnapshotCreateStatements(context),
    ...getUnitEconomicsSettingsCreateStatements(context),
    ...getUnitEconomicsMarginSnapshotCreateStatements(context),
    ...getClusterAutomationCreateStatements(context),
    ...getClusterAccrualCreateStatements(context),
  ];

  // Быстрые DDL (CREATE TABLE / ADD COLUMN) — ВСЕГДА, вне version-gate. Они идемпотентны
  // (IF NOT EXISTS) и мгновенны на уже существующих объектах, но критичны: новый код
  // ссылается на новую колонку СРАЗУ. Раньше при совпадении версии весь DDL пропускался —
  // и если забыли бампнуть CURRENT_SCHEMA_VERSION, колонка не создавалась → рантайм
  // «column does not exist» на каждом запросе. Теперь структура гарантирована независимо
  // от версии; version-gate остаётся только для ТЯЖЁЛОГО (backfill/INDEX по большим таблицам).
  const isFastDdl = (statement: string): boolean => {
    const s = statement.trimStart().toUpperCase();
    return s.startsWith("CREATE TABLE") || (s.startsWith("ALTER TABLE") && s.includes("ADD COLUMN"));
  };
  await executeSchemaStatements(context, allStatements.filter(isFastDdl));

  // Version-gate: тяжёлые миграции (backfill `WHERE col IS NULL` по млн строк, CREATE INDEX)
  // прогоняем только при смене версии — иначе каждый старт давал ~90с seq-сканов, а read-пути
  // ждут ensureSchema(). Backfill'ы одноразовые (write-путь заполняет колонки при вставке),
  // пропуск при совпадении версии безопасен. После изменения ТЯЖЁЛОЙ схемы — бамп версии.
  const installedVersion = await readInstalledSchemaVersion(context);
  if (installedVersion === CURRENT_SCHEMA_VERSION) {
    return;
  }
  await executeSchemaStatements(context, allStatements.filter((s) => !isFastDdl(s)));

  // Фиксируем применённую версию — следующий старт пройдёт version-gate мгновенно.
  await writeInstalledSchemaVersion(context, CURRENT_SCHEMA_VERSION);
}
