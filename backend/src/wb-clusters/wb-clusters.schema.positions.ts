import type { WbClustersSchemaContext } from "./wb-clusters.schema.types";

/**
 * wb_cluster_position_snapshots — место товара в поисковой выдаче WB по кластеру
 * на МОМЕНТ замера (в отличие от средней JAM-позиции «за период»).
 *
 * Источник: публичная выдача search.wb.ru. Зонд (wb-search-position-probe.client)
 * по репрезентативному (самому частотному) запросу кластера листает выдачу, находит
 * наш nm_id и фиксирует его позицию. Различаем:
 *   organic_position — органика БЕЗ рекламы (нумерация по органическим карточкам) — РАБОТАЕТ,
 *   display_position — органика С рекламой (реклама в счёте) — пока NULL,
 *   ad_position      — рекламный слот — пока NULL.
 * ВАЖНО: внутренний эндпоинт u-search отдаёт чисто органическую выдачу (поле logs пустое,
 * рекламных карточек нет). Поэтому достоверна только organic_position. display/ad_position
 * требуют отдельного рекламного фида WB (другой эндпоинт) — колонки заведены под будущее.
 *
 * Это ИСТОРИЯ (одна строка на каждый замер, captured_at), а не последнее значение —
 * чтобы видеть динамику места во времени. status фиксирует исход замера, в т.ч.
 * not_found/throttled/blocked — для понимания реальных лимитов на 1 IP.
 */
export function getClusterPositionSnapshotCreateStatements({
  tableName,
}: WbClustersSchemaContext): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tableName("wb_cluster_position_snapshots")} (
        id                      BIGSERIAL   PRIMARY KEY,
        nm_id                   BIGINT      NOT NULL,
        normalized_cluster_name TEXT        NOT NULL,
        cluster_name            TEXT        NOT NULL,
        probe_query             TEXT        NOT NULL,
        probe_frequency         NUMERIC,
        dest                    TEXT        NOT NULL,
        status                  TEXT        NOT NULL,
        organic_position        INTEGER,
        display_position        INTEGER,
        ad_position             INTEGER,
        is_ad                   BOOLEAN     NOT NULL DEFAULT FALSE,
        page                    INTEGER,
        scanned_count           INTEGER,
        captured_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    `
      ALTER TABLE ${tableName("wb_cluster_position_snapshots")}
        ADD COLUMN IF NOT EXISTS display_position INTEGER
    `,
    `
      CREATE INDEX IF NOT EXISTS wb_cluster_position_snapshots_latest_idx
        ON ${tableName("wb_cluster_position_snapshots")} (nm_id, normalized_cluster_name, captured_at DESC)
    `,
  ];
}
