import type { WbSellerAnalyticsApiClient } from "./wb-seller-analytics-api.client";
import { runAdSpendFullstatsSync } from "./wb-clusters-ad-spend-fullstats.flow";
import { WbClustersServiceDataOrdersRevenue } from "./wb-clusters.service.data-orders-revenue";

/**
 * Данные-секция, часть 2/3: «сегодняшние» live-заказы (воронка), % выкупа, Выручка, С/с продаж,
 * расход рекламы и ночные снапшоты С/с и % выкупа. Продолжение BaseA (наследует клиентов/хелперы).
 */
export abstract class WbClustersServiceDataRevenueAdSpend extends WbClustersServiceDataOrdersRevenue {
  // ─── Today's live orders via Sales Funnel (Воронка продаж) ───────────────────
  //
  // Источник: POST /api/analytics/v3/sales-funnel/products (сводка за период).
  // orderCount/orderSum совпадают с кабинетом WB «Заказали товаров (на сумму)» —
  // в отличие от Statistics API, Воронка ВКЛЮЧАЕТ заказы с неподтверждённой
  // оплатой. Statistics их выкидывал → систематический недосчёт (замерено вживую
  // 29.05: 883 против 1001 заказа, −12% count / −11% сумма). Именно эта дыра и
  // была видна как «у нас на ~100 меньше».
  //
  // Почему /products, а не /history: /history требует список nmId и режется по
  // 20 на запрос (весь каталог = ~23 батча × 25с ≈ 10 мин). /products НЕ требует
  // nmId и пагинируется по 1000 — все активные товары за сегодня приходят за
  // ОДИН запрос (≈ секунды). Эндпоинт отдаёт и orderCount/orderSum, и cancelCount.
  //
  // Что пишем для сегодняшней даты:
  //   - orders_count    = orderCount  (как в кабинете);
  //   - orders_sum      = orderSum    («Заказали на сумму»);
  //   - cancelled_count = cancelCount (Воронка отдаёт отмены отдельно).
  // Buyouts не трогаем — их закрывает ночной CSV.
  //
  // NB: данные Воронки у WB обновляются примерно раз в час, поэтому чаще, чем
  // раз в ~15 мин (см. wbOrdersSyncCron), дёргать смысла нет — число всё равно
  // меняется не чаще часа. Запрос дешёвый (1 шт.), в лимит 3 req/min укладывается
  // с запасом.

  async syncOrdersTodayFromSalesFunnel(): Promise<void> {
    if (!await this.guardOrdersSync()) return;

    const todayStr = this.getMoscowDateStr(0);
    let products: Awaited<ReturnType<WbSellerAnalyticsApiClient["fetchProductsSummary"]>>;
    try {
      products = await this.analyticsClient.fetchProductsSummary(todayStr, todayStr);
    } catch (err) {
      // Запрос не удался — НЕ обнуляем сегодня, оставляем прошлые значения.
      this.logger.warn(`Orders Sales Funnel sync error: ${(err as Error).message}`);
      return;
    }

    const upserts: { nmId: number; ordersCount: number; cancelledCount: number; ordersSum: number }[] = [];
    let totalOrders = 0;
    let totalSum = 0;
    for (const p of products) {
      if (p.orderCount === 0 && p.orderSum === 0) continue;
      totalOrders += p.orderCount;
      totalSum += p.orderSum;
      upserts.push({
        nmId: p.nmId,
        ordersCount: p.orderCount,
        cancelledCount: p.cancelCount,
        ordersSum: Math.round(p.orderSum * 100) / 100,
      });
    }

    // Сначала обнуляем сегодняшние строки (товары, чьи заказы за день обнулились,
    // корректно падают на 0), затем пишем живые агрегаты из Воронки.
    await this.wbClustersRepository.resetTodayLiveOrdersFields();
    if (upserts.length > 0) {
      await this.wbClustersRepository.upsertOrdersTodayLive(upserts);
    }
    this.logger.log(
      `Orders Sales Funnel sync (${todayStr}): ${products.length} активных товаров → ` +
        `${upserts.length} с заказами, ${totalOrders} заказов, сумма ${totalSum.toFixed(2)}`,
    );
  }

  // ─── Buyout % read-model ────────────────────────────────────────────────────

  /** Returns today's buyout counts (with matching orders counts) per product. */
  async getTodayBuyoutCounts() {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const items = await this.wbClustersRepository.getTodayBuyoutCounts();
    return { items };
  }

  /**
   * Rolling-window buyout counts (default: 365 days). Frontend renders
   * % выкупа = buyouts / orders × 100 for this aggregate.
   *
   * Reads the precomputed daily snapshot (instant). Falls back to on-the-fly
   * aggregation only if the snapshot table is empty (cold start).
   */
  async getRollingBuyoutCounts(days = 365) {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    // Считаем ЖИВОЕ скользящее окно, заканчивающееся СЕГОДНЯ. Раньше тут
    // короткозамыкался getLatestBuyoutSnapshot() (последний снапшот = вчера),
    // из-за чего колонка «сегодня» в ретроспективе байт-в-байт повторяла колонку
    // «вчера» — это и была «нет разницы в Итого». Окно до сегодня отличается от
    // вчерашнего снапшота (включает сегодняшние заказы), так что дубля больше нет.
    const items = await this.wbClustersRepository.getRollingBuyoutCounts(days);
    return { items };
  }

  /**
   * Snapshot matrix for the «% выкупа» retrospective: dates + per-product %
   * per day. Read straight from wb_product_buyout_daily_snapshot — instant.
   */
  async getBuyoutSnapshotMatrix() {
    if (!this.wbClustersRepository.isConfigured()) return { dates: [], products: [] };
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getBuyoutSnapshotMatrix();
  }

  // ─── Выручка (производная: Сумма заказов × % выкупа) ──────────────────────────
  //
  // Потенциальная выручка за день = сумма заказов × доля выкупа. Метрика
  // полностью считается ЗДЕСЬ, на сервере (фронт только рисует) — из этих цифр
  // дальше вырастут более сложные формулы (минус возвраты, комиссия, логистика,
  // хранение), и им место в одном источнике истины под тестами.
  //
  // «Сегодня»: ordersSum(today) × rolling-выкуп(365). «История»: ordersSum(дата) ×
  // %выкупа(дата) из снапшот-матрицы — ровно тот же выкуп, что показывает
  // ретроспектива «% выкупа» за этот день. «Нет данных» → товар не попадает в
  // выдачу, если нет суммы заказов ИЛИ нет выкупа (0 выкупов = WB ещё не отдал).

  /** Сегодняшняя потенциальная выручка по товарам: ordersSum × rolling-выкуп. */
  async getTodayRevenue(): Promise<{ items: { nmId: number; revenue: number }[] }> {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const [ordersSum, buyout] = await Promise.all([
      this.wbClustersRepository.getTodayOrdersSum(),
      this.wbClustersRepository.getRollingBuyoutCounts(365),
    ]);
    const buyoutByNmId = new Map<number, { ordersCount: number; buyoutsCount: number }>();
    for (const b of buyout) buyoutByNmId.set(b.nmId, b);
    const items: { nmId: number; revenue: number }[] = [];
    for (const o of ordersSum) {
      if (o.ordersSum <= 0) continue;
      const b = buyoutByNmId.get(o.nmId);
      if (!b || b.ordersCount === 0 || b.buyoutsCount === 0) continue;
      const buyoutFraction = b.buyoutsCount / b.ordersCount;
      items.push({ nmId: o.nmId, revenue: o.ordersSum * buyoutFraction });
    }
    return { items };
  }

  /** Матрица "товары × даты" выручки (compact): ordersSum(дата) × %выкупа(дата) / 100. */
  async getRevenueMatrixCompact(): Promise<{
    dates: string[];
    products: { nmId: number; vals: (number | null)[] }[];
  }> {
    if (!this.wbClustersRepository.isConfigured()) return { dates: [], products: [] };
    await this.wbClustersRepository.ensureSchema();
    const [ordersRows, buyoutMatrix] = await Promise.all([
      this.wbClustersRepository.getOrdersSumMatrix(),
      this.wbClustersRepository.getBuyoutSnapshotMatrix(),
    ]);
    if (ordersRows.length === 0) return { dates: [], products: [] };

    // %выкупа по (nmId, дата) из снапшот-матрицы — для быстрого джойна с заказами.
    const buyoutDateIdx = new Map<string, number>();
    buyoutMatrix.dates.forEach((d, i) => buyoutDateIdx.set(d, i));
    const buyoutByNmId = new Map<number, (number | null)[]>();
    for (const p of buyoutMatrix.products) buyoutByNmId.set(p.nmId, p.percents);

    // Колонки = дни, за которые есть И сумма заказов, И снапшот %выкупа: выручка =
    // ordersSum × %выкупа, без %выкупа её не посчитать. Заказы бэкфилятся за год назад,
    // а снапшоты %выкупа копятся вперёд от момента запуска — поэтому без фильтра по
    // выкупу матрица показывала год пустых колонок «—». Оставляем только дни с реальными
    // данными; история копится сама по мере накопления снапшотов выкупа.
    const datesSet = new Set<string>();
    for (const r of ordersRows) {
      if (buyoutDateIdx.has(r.orderDate)) datesSet.add(r.orderDate);
    }
    const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1));
    const dateIdx = new Map<string, number>();
    for (let i = 0; i < dates.length; i++) dateIdx.set(dates[i]!, i);

    const productMap = new Map<number, (number | null)[]>();
    for (const r of ordersRows) {
      const colIdx = dateIdx.get(r.orderDate);
      if (colIdx === undefined) continue;
      if (r.ordersSum <= 0) continue;
      const percents = buyoutByNmId.get(r.nmId);
      const bIdx = buyoutDateIdx.get(r.orderDate);
      const percent = percents && bIdx !== undefined ? percents[bIdx] : null;
      if (percent == null) continue; // нет выкупа за этот день → «нет данных»
      let vals = productMap.get(r.nmId);
      if (!vals) {
        vals = new Array<number | null>(dates.length).fill(null);
        productMap.set(r.nmId, vals);
      }
      vals[colIdx] = (r.ordersSum * percent) / 100;
    }
    const products = Array.from(productMap.entries()).map(([nmId, vals]) => ({ nmId, vals }));
    return { dates, products };
  }

  // ─── С/с продаж (производная: Заказы × % выкупа × себестоимость) ──────────────
  //
  // Себестоимость выкупленных заказов — зеркало «Выручки», только себестоимость
  // вместо суммы заказов. Метрика считается ЗДЕСЬ, на сервере (фронт рисует).
  // «Сегодня»: заказы(today) × rolling-выкуп(365) × текущая себестоимость.
  // «История»: cost_sum за день из снапшот-таблицы (тот же % выкупа, что у Выручки).
  // Ретроспектива стартует с момента запуска и копится вперёд — backfill НЕ делаем
  // (себестоимость по прошлым дням недостоверна). «Нет данных» → товар не в выдаче,
  // если нет заказов ИЛИ нет выкупа (0 выкупов = лаг WB) ИЛИ нет себестоимости.

  /** Сегодняшняя «С/с продаж» по товарам: заказы(today) × rolling-выкуп × себестоимость. */
  async getTodayCostSum(): Promise<{ items: { nmId: number; costSum: number }[] }> {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const [todayCounts, rolling, costs] = await Promise.all([
      this.wbClustersRepository.getTodayBuyoutCounts(),
      this.wbClustersRepository.getRollingBuyoutCounts(365),
      this.wbClustersRepository.getAllCurrentCostPrices(),
    ]);
    const rollingByNmId = new Map<number, { ordersCount: number; buyoutsCount: number }>();
    for (const b of rolling) rollingByNmId.set(b.nmId, b);
    const costByNmId = new Map<number, number>();
    for (const c of costs) costByNmId.set(c.nmId, c.costValue);
    const items: { nmId: number; costSum: number }[] = [];
    for (const t of todayCounts) {
      if (t.ordersCount <= 0) continue;
      const b = rollingByNmId.get(t.nmId);
      if (!b || b.ordersCount === 0 || b.buyoutsCount === 0) continue;
      const cost = costByNmId.get(t.nmId);
      if (cost == null || cost <= 0) continue;
      const buyoutFraction = b.buyoutsCount / b.ordersCount;
      items.push({ nmId: t.nmId, costSum: t.ordersCount * buyoutFraction * cost });
    }
    return { items };
  }

  /** Матрица "товары × даты" «С/с продаж» (compact) — читается из снапшот-таблицы. */
  async getCostSumMatrixCompact(): Promise<{
    dates: string[];
    products: { nmId: number; vals: (number | null)[] }[];
  }> {
    if (!this.wbClustersRepository.isConfigured()) return { dates: [], products: [] };
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getCostSumSnapshotMatrix();
  }

  // ─── Расходы на рекламу (агрегат wb_advert_daily_spend по товару) ─────────────
  //
  // «Общий расход на товар» = SUM(spend) по всем кампаниям товара за день.
  // Источник — ПОЛНЫЙ расход кампании из GET /adv/v3/fullstats (как в кабинете WB):
  // часовой крон syncAdSpendFromFullstats пишет (advert × товар × день), фронт
  // читает готовые строки. Раньше брали SUM(spend) из normquery/stats — там расход
  // только по поисковым запросам, показы вне поиска (каталог/карточки/рекомендации)
  // терялись, и суммы выходили заметно ниже кабинета.

  /**
   * Часовой синк полного расхода рекламы из WB GET /adv/v3/fullstats →
   * wb_advert_daily_spend. Логика — в wb-clusters-ad-spend-fullstats.flow.ts.
   */
  async syncAdSpendFromFullstats(): Promise<void> {
    return runAdSpendFullstatsSync(this);
  }

  /** Сегодняшний (МСК) расход на рекламу по товарам. */
  async getTodayAdSpend(): Promise<{ items: { nmId: number; spend: number }[] }> {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const today = this.getMoscowDateStr(0);
    const items = await this.wbClustersRepository.getAdSpendForDate(today);
    return { items };
  }

  /** Compact-матрица «товары × даты» расхода на рекламу. */
  async getAdSpendMatrixCompact(): Promise<{
    dates: string[];
    products: { nmId: number; vals: (number | null)[] }[];
  }> {
    if (!this.wbClustersRepository.isConfigured()) return { dates: [], products: [] };
    await this.wbClustersRepository.ensureSchema();
    const rows = await this.wbClustersRepository.getAdSpendMatrix();
    if (rows.length === 0) return { dates: [], products: [] };

    const datesSet = new Set<string>();
    for (const r of rows) datesSet.add(r.spendDate);
    const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1));
    const dateIdx = new Map<string, number>();
    for (let i = 0; i < dates.length; i++) dateIdx.set(dates[i]!, i);

    const productMap = new Map<number, (number | null)[]>();
    for (const r of rows) {
      const idx = dateIdx.get(r.spendDate);
      if (idx === undefined) continue;
      let vals = productMap.get(r.nmId);
      if (!vals) {
        vals = new Array<number | null>(dates.length).fill(null);
        productMap.set(r.nmId, vals);
      }
      vals[idx] = r.spend;
    }
    const products = Array.from(productMap.entries()).map(([nmId, vals]) => ({ nmId, vals }));
    return { dates, products };
  }

  /**
   * Фиксирует «С/с продаж» за вчера (Москва) в снапшот-таблицу. Запускается cron-ом
   * раз в сутки ПОСЛЕ снапшота % выкупа (тот же %, что и у «Выручки»). Строка за
   * закрытый день неизменна; история копится вперёд от момента запуска.
   */
  async snapshotCostSumForYesterday(): Promise<void> {
    if (!this.wbClustersRepository.isConfigured()) return;
    await this.wbClustersRepository.ensureSchema();
    const result = await this.wbClustersRepository.materializeCostSumSnapshotForYesterday();
    this.logger.log(
      `Cost-sum snapshot materialized for ${result.snapshotDate}: ${result.rowsWritten} rows`,
    );
  }

  /**
   * Fixes the «% выкупа» snapshot for yesterday (Moscow) based on the last `days`
   * days of wb_product_daily_orders. Runs once a day from cron at 03:40 МСК — after
   * the full-year orders backfill (03:30) and well after WB has finalized yesterday's
   * numbers (~02:00). The resulting row is the closed-day historical record.
   */
  async snapshotBuyoutsRolling(days = 365): Promise<void> {
    if (!this.wbClustersRepository.isConfigured()) return;
    await this.wbClustersRepository.ensureSchema();
    const result = await this.wbClustersRepository.materializeBuyoutSnapshotForYesterday(days);
    this.logger.log(
      `Buyout-percent snapshot materialized for ${result.snapshotDate}: ${result.rowsWritten} rows (window ${days} d)`,
    );
  }

}
