import type { Client } from "pg";

/**
 * Пост-импортное обслуживание снапшота частот (после полной замены в
 * replaceMonthlyFrequencySnapshot). Оба шага best-effort — их сбой не должен ронять
 * уже закоммиченный импорт. Вынесено из persistence, чтобы тот не превышал порог размера.
 *
 *  1) Backfill denormalized monthly_frequency в составе кластеров из свежего снапшота:
 *     полный рефреш (stale перезаписывается последним отчётом), матч по identity со
 *     снятой пунктуацией. IS DISTINCT FROM держит объём записи/WAL пропорционально дельте.
 *  2) VACUUM (ANALYZE) частот — убрать dead-строки после DELETE-all + INSERT, чтобы
 *     таблица не держала «высокую воду» на диске от прогона к прогону. Без FULL — не
 *     блокирует чтение/drill-down; ANALYZE освежает статистику планировщика.
 */
export async function runPostFrequencyImportMaintenance(
  client: Client,
  tableName: (name: string) => string,
): Promise<void> {
  try {
    // 0) Backfill identity для строк состава, предшествующих колонке (или из старого
    // импорта). Выражение реплицирует normalizeAdvertisingIdentity() (trim -> lower ->
    // пунктуация->пробел -> схлопывание, без финального trim).
    const identityBackfill = await client.query(
      `UPDATE ${tableName("wb_cabinet_cluster_queries")}
          SET normalized_query_identity = REGEXP_REPLACE(
                REGEXP_REPLACE(
                  LOWER(TRIM(query_text)),
                  '[]_/\\\\|.,:;!?(){}"''+=*%#№@\`~^&[-]+',
                  ' ', 'g'),
                '\\s+', ' ', 'g')
        WHERE normalized_query_identity IS NULL`,
    );
    if ((identityBackfill.rowCount ?? 0) > 0) {
      console.log(`  Cabinet identity backfill: ${identityBackfill.rowCount} rows populated.`);
    }
    // 1) Проставить/освежить частоту для запросов, присутствующих в новом отчёте.
    const matched = await client.query(
      `UPDATE ${tableName("wb_cabinet_cluster_queries")} c
         SET monthly_frequency = f.monthly_frequency
         FROM (
           SELECT normalized_query_identity, MAX(monthly_frequency) AS monthly_frequency
           FROM ${tableName("wb_search_query_frequencies")}
           GROUP BY normalized_query_identity
         ) f
        WHERE c.normalized_query_identity = f.normalized_query_identity
          AND c.monthly_frequency IS DISTINCT FROM f.monthly_frequency`,
    );
    // 2) Обнулить частоту для запросов, выпавших из нового отчёта.
    const cleared = await client.query(
      `UPDATE ${tableName("wb_cabinet_cluster_queries")} c
         SET monthly_frequency = NULL
        WHERE c.monthly_frequency IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ${tableName("wb_search_query_frequencies")} f
            WHERE f.normalized_query_identity = c.normalized_query_identity
          )`,
    );
    console.log(
      `  Cabinet frequency backfill: ${matched.rowCount ?? 0} refreshed, ${cleared.rowCount ?? 0} cleared.`,
    );
  } catch (backfillError) {
    console.error("Cabinet frequency backfill failed (non-fatal):", backfillError);
  }

  try {
    await client.query(`VACUUM (ANALYZE) ${tableName("wb_search_query_frequencies")}`);
    console.log("  Снапшот частот вычищен (VACUUM ANALYZE).");
  } catch (vacuumError) {
    console.error("VACUUM frequencies failed (non-fatal):", vacuumError);
  }
}
