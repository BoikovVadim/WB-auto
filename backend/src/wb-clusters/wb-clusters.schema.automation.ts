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
    // suggested_review_action — ADVISORY-рекомендация мусор-фильтра релевантности для
    // pending-кластеров: 'approve' (в работу) | 'blacklist' (в чёрный список). Движок только
    // подписывает, решение принимает человек. NULL для не-pending. См. product-cluster-relevance.ts.
    `
      ALTER TABLE ${tableName("wb_cluster_automation_state")}
        ADD COLUMN IF NOT EXISTS suggested_review_action TEXT NULL
    `,
    // last_cr / last_bid_cap — этап 2 ставочного движка (наблюдение в preview): CR показ→заказа
    // и потолок ставки CPM (Макс СРО × 1000 × CR) по накопителям текущей ценовой корзины.
    // Сам движок ставок (применение к WB) — этап 3. См. product-cluster-bid.ts.
    `
      ALTER TABLE ${tableName("wb_cluster_automation_state")}
        ADD COLUMN IF NOT EXISTS last_cr NUMERIC(10,6) NULL
    `,
    `
      ALTER TABLE ${tableName("wb_cluster_automation_state")}
        ADD COLUMN IF NOT EXISTS last_bid_cap NUMERIC(12,2) NULL
    `,
    // Этап 3 (позиционный регулятор): наблюдение за ставкой — последняя замеренная позиция
    // (с рекламой), желаемая ставка и причина решения. Заполняет bid-движок; применение на WB
    // только для товаров из scope (allowlist). См. product-cluster-bid.ts / bid-engine сервис.
    `
      ALTER TABLE ${tableName("wb_cluster_automation_state")}
        ADD COLUMN IF NOT EXISTS last_position INTEGER NULL
    `,
    `
      ALTER TABLE ${tableName("wb_cluster_automation_state")}
        ADD COLUMN IF NOT EXISTS last_desired_bid NUMERIC(12,2) NULL
    `,
    `
      ALTER TABLE ${tableName("wb_cluster_automation_state")}
        ADD COLUMN IF NOT EXISTS last_bid_reason TEXT NULL
    `,
    // bid_reached_top — достигал ли кластер топ-4 хоть раз (фаза ставочного движка): до
    // первого достижения разгон +10%, после — точный шаг ±10₽. См. product-cluster-bid.ts.
    `
      ALTER TABLE ${tableName("wb_cluster_automation_state")}
        ADD COLUMN IF NOT EXISTS bid_reached_top BOOLEAN NOT NULL DEFAULT FALSE
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
    // wb_cluster_relevance_term — ОБУЧЕНИЕ мусор-фильтра от действий менеджера (по товару).
    // Каждое решение в модалке модерации обновляет счётчики слов: approve/protect → pos_count,
    // reject (чёрный) → neg_count. Слово с перевесом neg, которого нет в базовом релевантном
    // наборе, → выученный «негатив»: новые кластеры с ним авто-уходят в чёрный (случай «шиншилл»).
    // Уровень — товар (nm_id). См. product-cluster-relevance.ts / .service.ts.
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_relevance_term")} (
        nm_id      BIGINT      NOT NULL,
        token      TEXT        NOT NULL,
        pos_count  INTEGER     NOT NULL DEFAULT 0,
        neg_count  INTEGER     NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (nm_id, token)
      )
    `,
  ];
}
