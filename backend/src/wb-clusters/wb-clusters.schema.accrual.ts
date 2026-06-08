import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

/**
 * Накопительные счётчики кластера по ценовым корзинам (для новой логики автоматизации:
 * фаза LEARNING + регулятор ДРР). Подробности модели — в памяти project-cluster-ad-strategy.
 *
 * ЗАЧЕМ накопление, а не скользящее 30-дн окно (как в getClusterCpoInputs): при медленном
 * расходе кластер при скользящем окне НИКОГДА не дорастает до порога LEARNING (2× Макс СРО) —
 * окно забывает старый расход быстрее, чем кластер его копит, и кластер сливает деньги вечно.
 * Накопительный счётчик копит spend/orders от точки старта корзины и не забывает.
 *
 * ЗАЧЕМ ценовые корзины (price_bucket): статистика собрана при КОНКРЕТНОЙ цене (цена —
 * главный фактор конверсии). При скачках цены 1400→2000→1400 простой «сброс» выбрасывал бы
 * данные и заставлял пересобирать разведку каждый раз (перерасход). Вместо этого — отдельный
 * накопитель на каждый ценовой уровень («зачётка на ценник»): вернулись на 1400 → открываем
 * готовую корзину, не пересобираем. Платим за разведку каждого уровня один раз. Корзина =
 * округление цены со скидкой по относительному шагу ±5% (логика округления — в коде, priceBucket()).
 *
 * Ключ накопления: (advert_id, nm_id, normalized_cluster_name, price_bucket).
 * accrued_* копятся ежедневным аккумулятором (крон), который прибавляет ВЧЕРАШНИЙ день из
 * wb_cluster_daily_stats (РК spend/orders) и дневные JAM-заказы. last_accrued_date защищает
 * от двойного прибавления одного дня (идемпотентность).
 */
export function getClusterAccrualCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_accrual")} (
        advert_id               BIGINT        NOT NULL,
        nm_id                   BIGINT        NOT NULL,
        normalized_cluster_name TEXT          NOT NULL,
        price_bucket            TEXT          NOT NULL,
        base_price              NUMERIC(12,2) NULL,
        accrued_spend           NUMERIC(14,2) NOT NULL DEFAULT 0,
        accrued_orders_rk       NUMERIC(14,2) NOT NULL DEFAULT 0,
        accrued_orders_jam      NUMERIC(14,2) NOT NULL DEFAULT 0,
        accrued_views           NUMERIC(14,2) NOT NULL DEFAULT 0,
        last_accrued_date       DATE          NULL,
        started_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        PRIMARY KEY (advert_id, nm_id, normalized_cluster_name, price_bucket)
      )
    `,
    // Накопленные ПОКАЗЫ кластера — для расчёта конверсии CR = заказы / показы (ставочный
    // движок: bid_cap = Макс СРО × 1000 × CR). ADD COLUMN — fast DDL, применяется на проде
    // вне version-gate, на существующей таблице добирает колонку с DEFAULT 0.
    `
      ALTER TABLE ${tableName("wb_cluster_accrual")}
        ADD COLUMN IF NOT EXISTS accrued_views NUMERIC(14,2) NOT NULL DEFAULT 0
    `,
    // Индекс под аккумулятор и чтение всех корзин кластера кампании (advert+nm).
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_accrual_campaign_idx
        ON ${tableName("wb_cluster_accrual")} (advert_id, nm_id)
    `,
  ];
}
