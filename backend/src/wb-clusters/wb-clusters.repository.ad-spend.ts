import { WbClustersRepositorySppDaily } from "./wb-clusters.repository.spp-daily";

/**
 * Расход на рекламу по товару — агрегат поверх wb_advert_daily_spend.
 *
 * Источник: ПОЛНЫЙ расход кампании из WB GET /adv/v3/fullstats (поле `sum`), как в
 * кабинете WB. В отличие от normquery/stats (там расход только в разрезе
 * поисковых запросов — показы вне поиска: каталог, карточки, рекомендации
 * теряются), fullstats отдаёт весь расход кампании с разбивкой по дням и товарам.
 * Часовой крон пишет (advert × товар × день) в wb_advert_daily_spend, отсюда же
 * читаем «общий расход на товар» = SUM(spend) по всем кампаниям товара за день.
 */
export abstract class WbClustersRepositoryAdSpend extends WbClustersRepositorySppDaily {
  /** Сумма расхода на рекламу по каждому товару за конкретный день (МСК). */
  async getAdSpendForDate(date: string): Promise<{ nmId: number; spend: number }[]> {
    const result = await this.getPool().query<{ nm_id: string; spend: string }>(
      `SELECT nm_id::text, SUM(spend)::text AS spend
         FROM ${this.tableName("wb_advert_daily_spend")}
        WHERE stat_date = $1::date
          AND spend IS NOT NULL
        GROUP BY nm_id
       HAVING SUM(spend) > 0`,
      [date],
    );
    return result.rows.map((r) => ({ nmId: Number(r.nm_id), spend: Number(r.spend) }));
  }

  /** Матрица «товар × дата» расхода на рекламу: одна строка на (nm_id, день). */
  async getAdSpendMatrix(): Promise<{ nmId: number; spendDate: string; spend: number }[]> {
    const result = await this.getPool().query<{
      nm_id: string;
      spend_date: string;
      spend: string;
    }>(
      `SELECT nm_id::text,
              TO_CHAR(stat_date, 'YYYY-MM-DD') AS spend_date,
              SUM(spend)::text                 AS spend
         FROM ${this.tableName("wb_advert_daily_spend")}
        WHERE spend IS NOT NULL
        GROUP BY nm_id, stat_date
       HAVING SUM(spend) > 0`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      spendDate: r.spend_date,
      spend: Number(r.spend),
    }));
  }

  /**
   * Upsert полного расхода рекламы (advert × товар × день) из fullstats.
   * Каждый прогон отдаёт полную сумму за день для пары (advert, nm) → перезапись
   * идемпотентна. Историю не удаляем: дни, которых WB не вернул, остаются как есть.
   */
  async upsertAdvertDailySpend(
    rows: Array<{
      advertId: number;
      nmId: number;
      statDate: string;
      spend: number | null;
      currency: string | null;
    }>,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    await this.ensureSchemaOrThrow();
    await this.getPool().query(
      `
        INSERT INTO ${this.tableName("wb_advert_daily_spend")} (
          advert_id, nm_id, stat_date, spend, currency, synced_at
        )
        SELECT advert_id, nm_id, stat_date::date, spend, currency, NOW()
        FROM UNNEST(
          $1::bigint[],
          $2::bigint[],
          $3::text[],
          $4::numeric[],
          $5::text[]
        ) AS rows(advert_id, nm_id, stat_date, spend, currency)
        ON CONFLICT (advert_id, nm_id, stat_date) DO UPDATE
        SET spend = EXCLUDED.spend,
            currency = EXCLUDED.currency,
            synced_at = NOW()
      `,
      [
        rows.map((row) => row.advertId),
        rows.map((row) => row.nmId),
        rows.map((row) => row.statDate),
        rows.map((row) => row.spend),
        rows.map((row) => row.currency),
      ],
    );
    return rows.length;
  }
}
