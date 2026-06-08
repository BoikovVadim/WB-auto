import { WbClustersRepositoryClusterRelevance } from "./wb-clusters.repository.cluster-relevance";

/** Дневная дельта расхода/заказов одного кластера за конкретный день (для аккумулятора). */
export interface DailyClusterDelta {
  normalizedClusterName: string;
  clusterName: string;
  /** Дневной расход РК за день (₽). */
  spend: number;
  /** Дневные заказы РК за день. */
  ordersRk: number;
  /** Дневные JAM-заказы за день (orders_current из подневного снапшота). */
  ordersJam: number;
  /** Дневные рекламные ПОКАЗЫ за день (для CR = заказы/показы). */
  views: number;
}

/** Накопленная корзина кластера (для движка решений). */
export interface ClusterAccrualBucket {
  normalizedClusterName: string;
  priceBucket: string;
  basePrice: number | null;
  accruedSpend: number;
  accruedOrdersRk: number;
  accruedOrdersJam: number;
  /** Накопленные показы — знаменатель CR. */
  accruedViews: number;
  lastAccruedDate: string | null;
}

/**
 * Звено репозитория: накопительные счётчики кластера по ценовым корзинам (wb_cluster_accrual).
 * Питает новую логику автоматизации (фаза LEARNING + регулятор ДРР) — см. схему
 * wb-clusters.schema.accrual.ts и память project-cluster-ad-strategy.
 */
export abstract class WbClustersRepositoryAccrual extends WbClustersRepositoryClusterRelevance {
  /** Вчерашняя дата по Москве (YYYY-MM-DD) — единый источник «вчера» для аккумулятора. */
  async getMskYesterday(): Promise<string> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{ d: string }>(
      `SELECT ((NOW() AT TIME ZONE 'Europe/Moscow')::DATE - 1)::text AS d`,
    );
    return result.rows[0]!.d;
  }

  /** Сегодняшняя дата МСК — для live-overlay накопителя (сегодняшние дельты поверх корзины). */
  async getMskToday(): Promise<string> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{ d: string }>(
      `SELECT ((NOW() AT TIME ZONE 'Europe/Moscow')::DATE)::text AS d`,
    );
    return result.rows[0]!.d;
  }

  /** Цена товара со скидкой (целые ₽) на конкретный день — для определения ценовой корзины.
   *  Берём снапшот за дату, а при отсутствии — ближайший ранее (цена меняется редко). */
  async getProductEffectivePriceForDate(
    nmId: number,
    date: string,
  ): Promise<number | null> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{ effective: string | null }>(
      `
      SELECT (price * (1 - COALESCE(discount, 0)::numeric / 100))::numeric AS effective
      FROM ${this.tableName("wb_product_daily_prices")}
      WHERE nm_id = $1 AND price_date <= $2::date
      ORDER BY price_date DESC
      LIMIT 1
      `,
      [nmId, date],
    );
    const v = result.rows[0]?.effective;
    return v != null ? Number(v) : null;
  }

  /** Дневные дельты РК+JAM по всем кластерам кампании за конкретный день. */
  async getDailyClusterDeltas(
    advertId: number,
    nmId: number,
    date: string,
  ): Promise<DailyClusterDelta[]> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      ncn: string;
      cluster_name: string | null;
      spend: string | null;
      orders_rk: string | null;
      orders_jam: string | null;
      views: string | null;
    }>(
      `
      WITH rk AS (
        SELECT normalized_cluster_name AS ncn,
               MAX(cluster_name)        AS cluster_name,
               SUM(spend)               AS spend,
               SUM(orders)              AS orders_rk,
               SUM(views)               AS views
        FROM ${this.tableName("wb_cluster_daily_stats")}
        WHERE advert_id = $1 AND nm_id = $2 AND stat_date = $3::date
        GROUP BY normalized_cluster_name
      ),
      jam AS (
        SELECT LOWER(TRIM(cq.cluster_name)) AS ncn,
               SUM(r.orders_current)        AS orders_jam
        FROM ${this.tableName("wb_cabinet_cluster_queries")} cq
        JOIN ${this.tableName("wb_product_search_text_range_snapshots")} s
          ON s.nm_id = $2 AND s.start_date = s.end_date AND s.start_date = $3::date
        JOIN ${this.tableName("wb_product_search_text_range_rows")} r
          ON r.snapshot_key = s.snapshot_key
         AND r.normalized_query_text = cq.normalized_query_text
        WHERE cq.advert_id = $1 AND cq.nm_id = $2
        GROUP BY LOWER(TRIM(cq.cluster_name))
      )
      SELECT COALESCE(rk.ncn, jam.ncn)            AS ncn,
             rk.cluster_name                       AS cluster_name,
             rk.spend                              AS spend,
             rk.orders_rk                          AS orders_rk,
             jam.orders_jam                        AS orders_jam,
             rk.views                              AS views
      FROM rk
      FULL OUTER JOIN jam ON jam.ncn = rk.ncn
      `,
      [advertId, nmId, date],
    );
    const num = (v: string | null): number => (v != null ? Number(v) : 0);
    return result.rows.map((r) => ({
      normalizedClusterName: r.ncn,
      clusterName: r.cluster_name ?? r.ncn,
      spend: num(r.spend),
      ordersRk: num(r.orders_rk),
      ordersJam: num(r.orders_jam),
      views: num(r.views),
    }));
  }

  /**
   * Идемпотентно прибавить дневные дельты в ценовые корзины. day прибавляется только если он
   * ещё НЕ учтён в этой корзине (last_accrued_date < day) — защита от двойного счёта при
   * повторном прогоне крона. priceBucket один на товар за день (цена товара), basePrice — для справки.
   */
  async accrueDailyDeltas(input: {
    advertId: number;
    nmId: number;
    priceBucket: string;
    basePrice: number | null;
    date: string;
    deltas: DailyClusterDelta[];
  }): Promise<void> {
    if (input.deltas.length === 0) return;
    await this.ensureSchemaOrThrow();
    const values: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const d of input.deltas) {
      values.push(
        `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}::date)`,
      );
      params.push(
        input.advertId,
        input.nmId,
        d.normalizedClusterName,
        input.priceBucket,
        input.basePrice,
        d.spend,
        d.ordersRk,
        d.ordersJam,
        d.views,
        input.date,
      );
    }
    await this.getPool().query(
      `
      INSERT INTO ${this.tableName("wb_cluster_accrual")}
        (advert_id, nm_id, normalized_cluster_name, price_bucket, base_price,
         accrued_spend, accrued_orders_rk, accrued_orders_jam, accrued_views, last_accrued_date)
      VALUES ${values.join(", ")}
      ON CONFLICT (advert_id, nm_id, normalized_cluster_name, price_bucket)
      DO UPDATE SET
        accrued_spend      = ${this.tableName("wb_cluster_accrual")}.accrued_spend      + EXCLUDED.accrued_spend,
        accrued_orders_rk  = ${this.tableName("wb_cluster_accrual")}.accrued_orders_rk  + EXCLUDED.accrued_orders_rk,
        accrued_orders_jam = ${this.tableName("wb_cluster_accrual")}.accrued_orders_jam + EXCLUDED.accrued_orders_jam,
        accrued_views      = ${this.tableName("wb_cluster_accrual")}.accrued_views      + EXCLUDED.accrued_views,
        last_accrued_date  = EXCLUDED.last_accrued_date,
        base_price         = COALESCE(EXCLUDED.base_price, ${this.tableName("wb_cluster_accrual")}.base_price),
        updated_at         = NOW()
      WHERE ${this.tableName("wb_cluster_accrual")}.last_accrued_date IS NULL
         OR ${this.tableName("wb_cluster_accrual")}.last_accrued_date < EXCLUDED.last_accrued_date
      `,
      params,
    );
  }

  /** Проставить/снять флаг drr_held (придержан регулятором ДРР) батчем по кластерам кампании. */
  async setClusterDrrHeld(
    advertId: number,
    nmId: number,
    items: { normalizedClusterName: string; held: boolean }[],
  ): Promise<void> {
    if (items.length === 0) return;
    await this.ensureSchemaOrThrow();
    const values: string[] = [];
    const params: unknown[] = [advertId, nmId];
    let i = 3;
    for (const it of items) {
      values.push(`($${i++}, $${i++}::boolean)`);
      params.push(it.normalizedClusterName, it.held);
    }
    await this.getPool().query(
      `
      UPDATE ${this.tableName("wb_cluster_automation_state")} s
      SET drr_held = v.held, decided_at = NOW()
      FROM (VALUES ${values.join(", ")}) AS v(ncn, held)
      WHERE s.advert_id = $1 AND s.nm_id = $2 AND s.normalized_cluster_name = v.ncn
      `,
      params,
    );
  }

  /** Накопленные корзины кластеров кампании (все ценовые уровни). */
  async getAccrualBuckets(
    advertId: number,
    nmId: number,
  ): Promise<ClusterAccrualBucket[]> {
    await this.ensureSchemaOrThrow();
    const result = await this.getPool().query<{
      normalized_cluster_name: string;
      price_bucket: string;
      base_price: string | null;
      accrued_spend: string;
      accrued_orders_rk: string;
      accrued_orders_jam: string;
      accrued_views: string;
      last_accrued_date: string | null;
    }>(
      `
      SELECT normalized_cluster_name, price_bucket, base_price::text,
             accrued_spend::text, accrued_orders_rk::text, accrued_orders_jam::text,
             accrued_views::text, last_accrued_date::text
      FROM ${this.tableName("wb_cluster_accrual")}
      WHERE advert_id = $1 AND nm_id = $2
      `,
      [advertId, nmId],
    );
    return result.rows.map((r) => ({
      normalizedClusterName: r.normalized_cluster_name,
      priceBucket: r.price_bucket,
      basePrice: r.base_price != null ? Number(r.base_price) : null,
      accruedSpend: Number(r.accrued_spend),
      accruedOrdersRk: Number(r.accrued_orders_rk),
      accruedOrdersJam: Number(r.accrued_orders_jam),
      accruedViews: Number(r.accrued_views),
      lastAccruedDate: r.last_accrued_date,
    }));
  }
}
