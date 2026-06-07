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
 *   cluster). is_protected — «белый список»: кластер нельзя отключать; is_blacklisted —
 *   «чёрный список»: кластер нельзя включать. Приоритет: чёрный > белый > CPO-правило.
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
        is_blacklisted          BOOLEAN      NOT NULL DEFAULT FALSE,
        updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        PRIMARY KEY (advert_id, nm_id, normalized_cluster_name)
      )
    `,
    // is_blacklisted добавлен позже — ALTER для уже созданных таблиц (идемпотентно).
    `
      ALTER TABLE ${tableName("wb_cluster_automation_override")}
        ADD COLUMN IF NOT EXISTS is_blacklisted BOOLEAN NOT NULL DEFAULT FALSE
    `,
    // last_spend добавлен позже — расход кластера за окно. Нужен для отображения «стоимости»
    // у кластеров без заказов: CPO там не определён (делить не на что), показываем расход.
    `
      ALTER TABLE ${tableName("wb_cluster_automation_state")}
        ADD COLUMN IF NOT EXISTS last_spend NUMERIC(12,2) NULL
    `,
    // review_status — модерация новых кластеров: 'pending' (ВБ добавил кластер после baseline,
    // ждёт ручной проверки — движок его НЕ трогает) | 'approved' (в работе у автоматики).
    // DEFAULT 'approved' → все ранее существовавшие строки становятся approved (грандфазер).
    `
      ALTER TABLE ${tableName("wb_cluster_automation_state")}
        ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved'
    `,
    // drr_held — кластер придержан РЕГУЛЯТОРОМ ДНЕВНОГО ДРР (рентабельный, но временно отключён
    // ради удержания дневного ДРР товара у плана). Ставит/снимает дневной регулятор; правило v2
    // (10-мин крон) ЧИТАЕТ флаг и при true принудительно держит excluded_drr — иначе затёр бы
    // решение регулятора. Снимется регулятором при недотрате ДРР (вернётся по возрастанию расхода).
    `
      ALTER TABLE ${tableName("wb_cluster_automation_state")}
        ADD COLUMN IF NOT EXISTS drr_held BOOLEAN NOT NULL DEFAULT FALSE
    `,
    // baselined_at — момент, когда зафиксирован «исходный» набор кластеров кампании.
    // Кластер без строки state, появившийся ПОСЛЕ baseline → новый → на проверку (pending).
    `
      ALTER TABLE ${tableName("wb_campaign_automation")}
        ADD COLUMN IF NOT EXISTS baselined_at TIMESTAMPTZ NULL
    `,
    // Грандфазер уже работающих кампаний на момент миграции: их текущие кластеры уже
    // имеют approved-строки (DEFAULT выше), проставляем baseline, чтобы НОВЫЕ кластеры
    // (которые ВБ добавит позже) уходили на ревью, а существующие — нет.
    `
      UPDATE ${tableName("wb_campaign_automation")}
        SET baselined_at = NOW()
        WHERE mode <> 'off' AND baselined_at IS NULL
    `,
  ];
}
