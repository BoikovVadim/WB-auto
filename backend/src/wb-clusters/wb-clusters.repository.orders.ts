import { WbClustersRepositoryChangeLog } from "./wb-clusters.repository.change-log";

export type DailyOrdersRow = {
  nmId: number;
  orderDate: string;   // "YYYY-MM-DD"
  ordersCount: number;
  cancelledCount: number;
  ordersSum: number;
  buyoutsCount: number;
  buyoutsSum: number;
};

/**
 * Orders repository.
 *
 * Single source of truth: wb_product_daily_orders(nm_id, order_date, orders_count).
 * Data comes from WB Analytics CSV report (DETAIL_HISTORY_REPORT).
 * Frontend reads with simple SELECT — no aggregation, no raw rows, no cursors.
 */
export abstract class WbClustersRepositoryOrders extends WbClustersRepositoryChangeLog {
  /** Deletes order rows for a single calendar day. Used for targeted re-sync. */
  async clearOrdersForDay(moscowDateStr: string): Promise<void> {
    await this.getPool().query(
      `DELETE FROM ${this.tableName("wb_product_daily_orders")} WHERE order_date = $1::DATE`,
      [moscowDateStr],
    );
  }

  /**
   * Deletes order rows in [fromDateStr, today). Today's row preserved —
   * Statistics API hourly job is the source of truth for today (live).
   * Accepts a "YYYY-MM-DD" Moscow date string.
   */
  async clearOrdersForDateRange(fromDateStr: string): Promise<void> {
    await this.getPool().query(
      `DELETE FROM ${this.tableName("wb_product_daily_orders")}
       WHERE order_date >= $1::DATE
         AND order_date < (NOW() AT TIME ZONE 'Europe/Moscow')::DATE`,
      [fromDateStr],
    );
  }

  /**
   * Upserts aggregated daily order rows from CSV report.
   * For TODAY: orders_count/cancelled_count/orders_sum are preserved on conflict —
   * those fields are owned by the Statistics API hourly job (live data, no daily limit).
   * Buyouts always come from CSV (today's buyouts are usually 0 anyway, lag too big).
   *
   * Diff-aware: на конфликте строка обновляется ТОЛЬКО если хоть одно значение
   * реально изменилось (`IS DISTINCT FROM`). Это нужно ночной полной сверке —
   * WB задним числом доуточняет суммы за ~2 недели, и мы хотим трогать (и бампать
   * updated_at) лишь те дни, что действительно поменялись, а не весь год вслепую.
   * RETURNING отдаёт затронутые product-day строки, чтобы сервис мог залогировать,
   * какие именно даты подтянулись («чтобы было точно»). Для TODAY сравниваем только
   * выкупы — заказы за сегодня всё равно остаются за Statistics API.
   *
   * Возвращает число изменённых строк и список изменённых дат (по убыванию).
   */
  async upsertDailyOrders(rows: DailyOrdersRow[]): Promise<{ changedRows: number; changedDates: string[] }> {
    if (rows.length === 0) return { changedRows: 0, changedDates: [] };
    const tbl = this.tableName("wb_product_daily_orders");
    const today = "(NOW() AT TIME ZONE 'Europe/Moscow')::DATE";

    const COLS = 7;
    // Postgres encodes the bind-message parameter count as Int16 (max 65535).
    // Годовая сверка апсертит весь год (товары × ~365 дней) — это сотни тысяч
    // параметров, счётчик переполнялся → `bind message has N parameter formats
    // but 0 parameters` (08P01), и годовая сверка молча падала. Режем на чанки
    // c запасом: 5000 строк × 7 = 35000 параметров на запрос. Апсерт diff-aware
    // и идемпотентный, так что разбиение на несколько запросов безопасно.
    const CHUNK_ROWS = 5000;

    let changedRows = 0;
    const changedDateSet = new Set<string>();

    for (let offset = 0; offset < rows.length; offset += CHUNK_ROWS) {
      const chunk = rows.slice(offset, offset + CHUNK_ROWS);
      const values: unknown[] = [];
      const placeholders = chunk.map((r, i) => {
        const b = i * COLS;
        values.push(
          r.nmId,
          r.orderDate,
          r.ordersCount,
          r.cancelledCount,
          r.ordersSum,
          r.buyoutsCount,
          r.buyoutsSum,
        );
        return `($${b+1}, $${b+2}, $${b+3}, $${b+4}, $${b+5}, $${b+6}, $${b+7}, NOW())`;
      });

      const result = await this.getPool().query<{ order_date: string }>(
        `INSERT INTO ${tbl}
           (nm_id, order_date, orders_count, cancelled_count, orders_sum,
            buyouts_count, buyouts_sum, updated_at)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (nm_id, order_date) DO UPDATE SET
           orders_count    = CASE
             WHEN ${tbl}.order_date = ${today}
               THEN ${tbl}.orders_count
             ELSE EXCLUDED.orders_count
           END,
           cancelled_count = CASE
             WHEN ${tbl}.order_date = ${today}
               THEN ${tbl}.cancelled_count
             ELSE EXCLUDED.cancelled_count
           END,
           orders_sum      = CASE
             WHEN ${tbl}.order_date = ${today}
               THEN ${tbl}.orders_sum
             ELSE EXCLUDED.orders_sum
           END,
           buyouts_count   = EXCLUDED.buyouts_count,
           buyouts_sum     = EXCLUDED.buyouts_sum,
           updated_at      = NOW()
         WHERE
           (${tbl}.order_date = ${today} AND (
              ${tbl}.buyouts_count IS DISTINCT FROM EXCLUDED.buyouts_count OR
              ${tbl}.buyouts_sum   IS DISTINCT FROM EXCLUDED.buyouts_sum))
           OR
           (${tbl}.order_date <> ${today} AND (
              ${tbl}.orders_count    IS DISTINCT FROM EXCLUDED.orders_count    OR
              ${tbl}.cancelled_count IS DISTINCT FROM EXCLUDED.cancelled_count OR
              ${tbl}.orders_sum      IS DISTINCT FROM EXCLUDED.orders_sum      OR
              ${tbl}.buyouts_count   IS DISTINCT FROM EXCLUDED.buyouts_count   OR
              ${tbl}.buyouts_sum     IS DISTINCT FROM EXCLUDED.buyouts_sum))
         RETURNING TO_CHAR(order_date, 'YYYY-MM-DD') AS order_date`,
        values,
      );

      changedRows += result.rowCount ?? result.rows.length;
      for (const r of result.rows) changedDateSet.add(r.order_date);
    }

    const changedDates = Array.from(changedDateSet).sort((a, b) => (a < b ? 1 : -1));
    return { changedRows, changedDates };
  }

  /**
   * Resets today's orders_count/cancelled_count/orders_sum to 0 for ALL products.
   * Called by the Statistics API hourly job before upsert — products whose orders
   * were all cancelled/removed since last sync will correctly drop to 0.
   */
  async resetTodayLiveOrdersFields(): Promise<void> {
    await this.getPool().query(
      `UPDATE ${this.tableName("wb_product_daily_orders")}
       SET orders_count = 0, cancelled_count = 0, orders_sum = 0, updated_at = NOW()
       WHERE order_date = (NOW() AT TIME ZONE 'Europe/Moscow')::DATE`,
    );
  }

  /**
   * Upserts today's live aggregates from the WB Sales Funnel (Воронка продаж).
   * Writes orders_count, cancelled_count, orders_sum (orderCount/orderSum —
   * метрика кабинета «Заказали товаров (на сумму)», включает неоплаченные).
   * Buyouts intentionally untouched (CSV-only source).
   */
  async upsertOrdersTodayLive(
    rows: { nmId: number; ordersCount: number; cancelledCount: number; ordersSum: number }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const tbl = this.tableName("wb_product_daily_orders");

    const COLS = 4;
    const values: unknown[] = [];
    const placeholders = rows.map((r, i) => {
      const b = i * COLS;
      values.push(r.nmId, r.ordersCount, r.cancelledCount, r.ordersSum);
      return `($${b+1}, (NOW() AT TIME ZONE 'Europe/Moscow')::DATE, $${b+2}, $${b+3}, $${b+4}, NOW())`;
    });

    await this.getPool().query(
      `INSERT INTO ${tbl}
         (nm_id, order_date, orders_count, cancelled_count, orders_sum, updated_at)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (nm_id, order_date) DO UPDATE SET
         orders_count    = EXCLUDED.orders_count,
         cancelled_count = EXCLUDED.cancelled_count,
         orders_sum      = EXCLUDED.orders_sum,
         updated_at      = NOW()`,
      values,
    );
  }

  /** Returns today's order counts per product. Equivalent to VLOOKUP by nmId on today's date. */
  async getTodayOrderCounts(): Promise<{ nmId: number; ordersCount: number; cancelledCount: number }[]> {
    const result = await this.getPool().query<{ nm_id: string; orders_count: string; cancelled_count: string }>(
      `SELECT nm_id::text, orders_count::text, cancelled_count::text
       FROM ${this.tableName("wb_product_daily_orders")}
       WHERE order_date = (NOW() AT TIME ZONE 'Europe/Moscow')::DATE`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      ordersCount: Number(r.orders_count),
      cancelledCount: Number(r.cancelled_count),
    }));
  }

  /** Returns all order counts (all dates, all products) for the retrospective matrix. */
  async getOrdersMatrix(): Promise<{ nmId: number; orderDate: string; ordersCount: number }[]> {
    const result = await this.getPool().query<{ nm_id: string; order_date: string; orders_count: string }>(
      `SELECT nm_id::text, TO_CHAR(order_date, 'YYYY-MM-DD') AS order_date, orders_count::text
       FROM ${this.tableName("wb_product_daily_orders")}
       ORDER BY nm_id ASC, order_date DESC`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      orderDate: r.order_date,
      ordersCount: Number(r.orders_count),
    }));
  }

  /**
   * Returns today's buyout counts + matching orders counts per product.
   * Frontend computes % выкупа = buyouts / orders × 100.
   */
  async getTodayBuyoutCounts(): Promise<{ nmId: number; ordersCount: number; buyoutsCount: number }[]> {
    const result = await this.getPool().query<{ nm_id: string; orders_count: string; buyouts_count: string }>(
      `SELECT nm_id::text, orders_count::text, buyouts_count::text
       FROM ${this.tableName("wb_product_daily_orders")}
       WHERE order_date = (NOW() AT TIME ZONE 'Europe/Moscow')::DATE`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      ordersCount: Number(r.orders_count),
      buyoutsCount: Number(r.buyouts_count),
    }));
  }

  /**
   * Returns SUM(orders) and SUM(buyouts) per product over a rolling window of
   * `days` ending YESTERDAY (Moscow) — последний закрытый день. Сегодня в окно
   * НЕ входит: WB-аналитика репортит buyouts с большим лагом, и сегодняшние
   * заказы (выкупов ≈ 0) систематически занижали бы процент. Так значение
   * «актуально на сегодня = весь закрытый год по вчера включительно».
   */
  async getRollingBuyoutCounts(
    days: number,
  ): Promise<{ nmId: number; ordersCount: number; buyoutsCount: number }[]> {
    const windowDays = Math.max(1, Math.floor(days));
    const result = await this.getPool().query<{
      nm_id: string;
      orders_count: string;
      buyouts_count: string;
    }>(
      `SELECT nm_id::text,
              SUM(orders_count)::text   AS orders_count,
              SUM(buyouts_count)::text  AS buyouts_count
       FROM ${this.tableName("wb_product_daily_orders")}
       WHERE order_date >= (NOW() AT TIME ZONE 'Europe/Moscow')::DATE - $1::INT
         AND order_date <= (NOW() AT TIME ZONE 'Europe/Moscow')::DATE - 1
       GROUP BY nm_id`,
      [windowDays],
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      ordersCount: Number(r.orders_count),
      buyoutsCount: Number(r.buyouts_count),
    }));
  }

  /**
   * Returns today's orders sum per product. Источник orders_sum: за СЕГОДНЯ —
   * Sales Funnel (orderSum), за прошлые дни — Analytics CSV (ordersSumRub). Оба
   * совпадают с цифрой WB-дашборда «Заказали товаров на сумму».
   *
   * NB: Statistics API (priceWithDisc) здесь НЕ используется — он исключает заказы
   * с неподтверждённой оплатой и давал систематическую недосумму (~11–12%).
   */
  async getTodayOrdersSum(): Promise<{ nmId: number; ordersSum: number }[]> {
    const result = await this.getPool().query<{ nm_id: string; orders_sum: string }>(
      `SELECT nm_id::text, orders_sum::text
       FROM ${this.tableName("wb_product_daily_orders")}
       WHERE order_date = (NOW() AT TIME ZONE 'Europe/Moscow')::DATE`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      ordersSum: Number(r.orders_sum),
    }));
  }

  /** Returns matrix nm_id × order_date with orders_sum (CSV, finishedPrice) for the retrospective sheet. */
  async getOrdersSumMatrix(): Promise<
    { nmId: number; orderDate: string; ordersSum: number }[]
  > {
    const result = await this.getPool().query<{
      nm_id: string;
      order_date: string;
      orders_sum: string;
    }>(
      `SELECT nm_id::text,
              TO_CHAR(order_date, 'YYYY-MM-DD') AS order_date,
              orders_sum::text
       FROM ${this.tableName("wb_product_daily_orders")}
       ORDER BY nm_id ASC, order_date DESC`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      orderDate: r.order_date,
      ordersSum: Number(r.orders_sum),
    }));
  }

  /**
   * Returns matrix nm_id × order_date with orders_count + buyouts_count.
   * Used by the retrospective buyout-% sheet to render historical days.
   */
  async getBuyoutMatrix(): Promise<{ nmId: number; orderDate: string; ordersCount: number; buyoutsCount: number }[]> {
    const result = await this.getPool().query<{
      nm_id: string;
      order_date: string;
      orders_count: string;
      buyouts_count: string;
    }>(
      `SELECT nm_id::text,
              TO_CHAR(order_date, 'YYYY-MM-DD') AS order_date,
              orders_count::text,
              buyouts_count::text
       FROM ${this.tableName("wb_product_daily_orders")}
       ORDER BY nm_id ASC, order_date DESC`,
    );
    return result.rows.map((r) => ({
      nmId: Number(r.nm_id),
      orderDate: r.order_date,
      ordersCount: Number(r.orders_count),
      buyoutsCount: Number(r.buyouts_count),
    }));
  }
}
