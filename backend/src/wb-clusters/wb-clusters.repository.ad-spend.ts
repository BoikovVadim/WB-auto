import { WbClustersRepositorySppDaily } from "./wb-clusters.repository.spp-daily";

/**
 * Расход на рекламу по товару — агрегат поверх wb_cluster_daily_stats.
 *
 * Источник: дневная статистика рекламы (cpm + cpc) по (кампания × товар × кластер × день).
 * «Общий расход на товар» = SUM(spend) по ВСЕМ кампаниям и кластерам товара за день.
 * Дневная статистика синкается для всех кампаний (cpm + cpc), поэтому SUM покрывает
 * весь расход (aggregate-таблица wb_cluster_stats — лишь дополнительный CPM-срез).
 * Никакой отдельной таблицы/крона не нужно: считаем на лету из уже синкаемой истории.
 */
export abstract class WbClustersRepositoryAdSpend extends WbClustersRepositorySppDaily {
  /** Сумма расхода на рекламу по каждому товару за конкретный день (МСК). */
  async getAdSpendForDate(date: string): Promise<{ nmId: number; spend: number }[]> {
    const result = await this.getPool().query<{ nm_id: string; spend: string }>(
      `SELECT nm_id::text, SUM(spend)::text AS spend
         FROM ${this.tableName("wb_cluster_daily_stats")}
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
         FROM ${this.tableName("wb_cluster_daily_stats")}
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
}
