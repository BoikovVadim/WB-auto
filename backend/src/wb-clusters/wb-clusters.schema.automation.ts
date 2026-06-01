import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

/**
 * Автоматизация управления кластерами по CPO.
 *
 * wb_campaign_automation — режим автоматизации на (advert_id, nm_id):
 *   'off' — выключена; 'preview' — движок считает решения и пишет их в state/журнал,
 *   но НЕ трогает WB; 'live' — реально включает/исключает кластеры через очередь действий.
 *
 * wb_cluster_automation_state — состояние движка по каждому кластеру:
 *   state: 'active' (CPO ≤ макс) | 'excluded_high' (CPO > макс) | 'dropped' (нет сигнала /
 *   данные старше 30 дней) | 'manual_protected' (сотрудник включил вручную выбывший кластер —
 *   иммунитет к выбыванию по «нет данных», авто-исключается только при реальном CPO > макс).
 *   state: ... | 'protected' (пользователь пометил «защищён» в «Настройке фильтров» —
 *   автоматика всегда держит активным, даже при высоком CPO);
 *   last_cpo — последний эффективный CPO; last_decision — include|exclude|noop (для preview-UI).
 *
 * wb_cluster_automation_override — ручные override пользователя поверх движка на (advert, nm,
 *   cluster). is_protected — кластер нельзя отключать (полный приоритет над CPO-правилом).
 */
export function getClusterAutomationCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_campaign_automation")} (
        advert_id   BIGINT       NOT NULL,
        nm_id       BIGINT       NOT NULL,
        mode        TEXT         NOT NULL DEFAULT 'off',
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        PRIMARY KEY (advert_id, nm_id),
        CONSTRAINT wb_campaign_automation_mode_chk
          CHECK (mode IN ('off', 'preview', 'live'))
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_automation_state")} (
        advert_id               BIGINT        NOT NULL,
        nm_id                   BIGINT        NOT NULL,
        normalized_cluster_name TEXT          NOT NULL,
        state                   TEXT          NOT NULL,
        manual_protected        BOOLEAN       NOT NULL DEFAULT FALSE,
        last_cpo                NUMERIC(12,2) NULL,
        last_decision           TEXT          NULL,
        decided_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        PRIMARY KEY (advert_id, nm_id, normalized_cluster_name)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_automation_override")} (
        advert_id               BIGINT       NOT NULL,
        nm_id                   BIGINT       NOT NULL,
        normalized_cluster_name TEXT         NOT NULL,
        cluster_name            TEXT         NOT NULL,
        is_protected            BOOLEAN      NOT NULL DEFAULT FALSE,
        updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        PRIMARY KEY (advert_id, nm_id, normalized_cluster_name)
      )
    `,
  ];
}
