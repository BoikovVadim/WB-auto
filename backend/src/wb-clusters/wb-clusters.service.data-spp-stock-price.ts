import { appEnv } from "../common/env";
import type { WbStatisticsApiClient } from "./wb-statistics-api.client";
import type { WbPricesApiClient } from "./wb-prices-api.client";
import { WbClustersServiceDataRevenueAdSpend } from "./wb-clusters.service.data-revenue-adspend";

/**
 * Данные-секция, часть 3/3: СПП, возвраты, остатки, цены (чтение/синк) и изменение цены с
 * записью на маркетплейс WB. Продолжение BaseB (наследует клиентов/хелперы).
 */
export abstract class WbClustersServiceDataSppStockPrice extends WbClustersServiceDataRevenueAdSpend {
  // ─── СПП (средняя скидка постоянного покупателя по заказам) ────────────────────
  //
  // spp приходит на каждый заказ ТОЛЬКО из Statistics API (/api/v1/supplier/orders).
  // «СПП за день» = простое среднее AVG(spp) по всем заказам товара за московский день.
  // «Сегодня» освежает 6-часовой cron, закрытый день добивается ночью, история — разовым
  // backfill за неделю. Источник тяжёлый (лимит ~1 запрос/мин) → НЕ считаем на лету на
  // каждый рендер: фронт читает уже сохранённые строки wb_product_spp_daily.

  /** Группирует строки заказов по nmId и считает простое среднее spp за день. */
  private aggregateSppByNm(
    rows: Awaited<ReturnType<WbStatisticsApiClient["fetchOrdersForDay"]>>,
  ): { nmId: number; sppAvg: number; ordersCount: number }[] {
    const acc = new Map<number, { sum: number; count: number }>();
    for (const r of rows) {
      if (typeof r.nmId !== "number" || typeof r.spp !== "number") continue;
      const e = acc.get(r.nmId);
      if (e) { e.sum += r.spp; e.count += 1; }
      else acc.set(r.nmId, { sum: r.spp, count: 1 });
    }
    const out: { nmId: number; sppAvg: number; ordersCount: number }[] = [];
    for (const [nmId, e] of acc) {
      if (e.count === 0) continue;
      out.push({ nmId, sppAvg: e.sum / e.count, ordersCount: e.count });
    }
    return out;
  }

  /** Тянет заказы за конкретный московский день (flag=1), считает среднюю СПП и апсертит. */
  async syncSppForDay(moscowDateStr: string): Promise<void> {
    if (!await this.guardOrdersSync()) return;
    let rows: Awaited<ReturnType<WbStatisticsApiClient["fetchOrdersForDay"]>>;
    try {
      rows = await this.statisticsApiClient.fetchOrdersForDay(moscowDateStr);
    } catch (err) {
      this.logger.warn(`SPP sync ${moscowDateStr}: ошибка загрузки заказов: ${(err as Error).message}`);
      return;
    }
    const aggregates = this.aggregateSppByNm(rows);
    const written = await this.wbClustersRepository.upsertSppDaily(moscowDateStr, aggregates);
    this.logger.log(`SPP sync ${moscowDateStr}: ${written} товаров (из ${rows.length} заказов)`);
  }

  /** Освежает СПП за сегодня (Москва). Cron каждые 6 часов. */
  async syncSppToday(): Promise<void> {
    await this.syncSppForDay(this.getMoscowDateStr(0));
  }

  /** Добивает СПП за вчера (Москва) после закрытия дня. Ночной cron. */
  async syncSppYesterday(): Promise<void> {
    await this.syncSppForDay(this.getMoscowDateStr(-1));
  }

  /**
   * Разовый backfill СПП: сегодня + последние `days` закрытых дней. Каждый день —
   * отдельный запрос к Statistics API (троттл клиента ~1 req/min), поэтому 7 дней
   * ≈ 7-8 минут. Идемпотентно (ON CONFLICT перезаписывает день). Запускается в фоне
   * из контроллера разово после деплоя.
   */
  async backfillSppLastDays(days = 7): Promise<{ days: number }> {
    if (!await this.guardOrdersSync()) return { days: 0 };
    let done = 0;
    for (let offset = 0; offset <= days; offset++) {
      await this.syncSppForDay(this.getMoscowDateStr(-offset));
      done += 1;
    }
    this.logger.log(`SPP backfill завершён: ${done} дней (сегодня + ${days})`);
    return { days: done };
  }

  /** Сегодняшняя средняя СПП по товарам (читается из wb_product_spp_daily). */
  async getTodaySpp(): Promise<{ items: { nmId: number; spp: number }[] }> {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    return { items: await this.wbClustersRepository.getSppToday() };
  }

  /** Матрица "товары × даты" СПП (compact) — закрытые дни из wb_product_spp_daily. */
  async getSppMatrixCompact(): Promise<{
    dates: string[];
    products: { nmId: number; vals: (number | null)[] }[];
  }> {
    if (!this.wbClustersRepository.isConfigured()) return { dates: [], products: [] };
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getSppDailyMatrix();
  }

  /**
   * Rolling-window orders/cancels/returns aggregate per product (default 365 days).
   * Frontend computes % выкупа = (orders − cancels − returns) / orders × 100.
   */
  async getRollingBuyoutBreakdown(days = 365) {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const items = await this.wbClustersRepository.getRollingBuyoutBreakdown(days);
    return { items };
  }

  /**
   * Downloads sales (включая возвраты) from WB Statistics API since `daysBack` days ago,
   * filters returns (saleID starts with "R"), aggregates per nmId × date, and upserts
   * into wb_product_daily_returns. Always also clears the range to avoid stale rows
   * if WB later un-publishes a return entry.
   */
  async syncReturnsFromStatistics(daysBack = 7): Promise<void> {
    if (!await this.guardOrdersSync()) return;

    const fromDateStr = this.getMoscowDateStr(-daysBack);
    const dateFrom    = new Date(`${fromDateStr}T00:00:00+03:00`);
    this.logger.log(`Returns sync: from ${fromDateStr} (Moscow)`);

    type SaleRow = Awaited<ReturnType<WbStatisticsApiClient["fetchAllSales"]>>[number];
    let rows: SaleRow[];
    try {
      rows = await this.statisticsApiClient.fetchAllSales(dateFrom);
    } catch (err) {
      this.logger.warn(`Returns sync error: ${(err as Error).message}`);
      return;
    }

    // saleID starts with "R" → return. Use the `date` field as the customer-facing
    // event date (Moscow tz). Ignore anything older than fromDate.
    const counts = new Map<string, { nmId: number; returnDate: string; count: number }>();
    for (const r of rows) {
      if (typeof r.saleID !== "string" || !r.saleID.startsWith("R")) continue;
      if (!r.nmId || typeof r.date !== "string") continue;
      const dateOnly = r.date.slice(0, 10);
      if (dateOnly < fromDateStr) continue;
      const key = `${r.nmId}|${dateOnly}`;
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { nmId: r.nmId, returnDate: dateOnly, count: 1 });
    }

    const upsertRows = Array.from(counts.values()).map((c) => ({
      nmId: c.nmId,
      returnDate: c.returnDate,
      returnsCount: c.count,
    }));

    await this.wbClustersRepository.clearReturnsForDateRange(fromDateStr);
    if (upsertRows.length > 0) {
      await this.wbClustersRepository.upsertDailyReturns(upsertRows);
    }
    this.logger.log(`Returns sync done: ${upsertRows.length} product-day rows`);
  }

  /**
   * Downloads current stock balances from WB Statistics API and saves a daily snapshot.
   * Aggregates quantity across all warehouses per nmId. Run once at 01:00 MSK.
   */
  async syncStocksSnapshot(): Promise<void> {
    if (!appEnv.wbStocksSnapshotEnabled) return;
    if (!this.wbClustersRepository.isConfigured()) return;
    await this.wbClustersRepository.ensureSchema();
    const token = this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken;
    if (!token) { this.logger.warn("Stocks snapshot: WB_API_TOKEN not set, skip."); return; }

    // dateFrom 2 years ago — ensures WB returns all active stock rows
    const dateFrom = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
    const stockDate = this.getMoscowDateStr(0);
    this.logger.log(`Stocks snapshot: fetching for date ${stockDate}`);

    let rawRows: Awaited<ReturnType<WbStatisticsApiClient["fetchStocks"]>>;
    try {
      rawRows = await this.statisticsApiClient.fetchStocks(dateFrom);
    } catch (err) {
      this.logger.warn(`Stocks snapshot fetch error: ${(err as Error).message}`);
      return;
    }

    if (rawRows.length === 0) { this.logger.log("Stocks snapshot: empty response."); return; }

    // Aggregate: sum quantity across all warehouses per nmId
    const byNmId = new Map<number, number>();
    for (const r of rawRows) {
      byNmId.set(r.nmId, (byNmId.get(r.nmId) ?? 0) + r.quantity);
    }

    const rows = Array.from(byNmId.entries()).map(([nmId, quantity]) => ({
      nmId,
      stockDate,
      quantity,
    }));

    await this.wbClustersRepository.upsertDailyStocks(rows);
    this.logger.log(`Stocks snapshot done: ${rows.length} products saved for ${stockDate}`);
  }

  /** Returns latest stock quantity per nmId (for the inline table column). */
  async getLatestStocks(): Promise<{ nmId: number; quantity: number }[]> {
    if (!this.wbClustersRepository.isConfigured()) return [];
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getLatestStocks();
  }

  /** Returns the full stocks matrix (all dates × all products) for the frontend. */
  async getStocksMatrix(): Promise<{ nmId: number; stockDate: string; quantity: number }[]> {
    if (!this.wbClustersRepository.isConfigured()) return [];
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getStocksMatrix();
  }

  /**
   * Downloads current prices and seller discounts from WB Prices API
   * and saves a daily snapshot.
   */
  async syncPricesFromWb(): Promise<void> {
    if (!this.wbClustersRepository.isConfigured()) return;
    await this.wbClustersRepository.ensureSchema();
    const token = this.wbRuntimeConfigService.getResolvedToken() || appEnv.wbApiToken;
    if (!token) { this.logger.warn("Prices sync: WB_API_TOKEN not set, skip."); return; }

    const priceDate = this.getMoscowDateStr(0);
    this.logger.log(`Prices sync: fetching for date ${priceDate}`);

    let goods: Awaited<ReturnType<WbPricesApiClient["fetchAllGoods"]>>;
    try {
      goods = await this.pricesApiClient.fetchAllGoods();
    } catch (err) {
      this.logger.warn(`Prices sync fetch error: ${(err as Error).message}`);
      return;
    }

    if (goods.length === 0) { this.logger.log("Prices sync: empty response."); return; }

    // Take the first size price as representative for the nmId (all sizes share the same discount)
    const rows = goods.flatMap((g) => {
      const firstSize = g.sizes[0];
      if (!firstSize || firstSize.price <= 0) return [];
      return [{ nmId: g.nmID, priceDate, price: firstSize.price, discount: g.discount }];
    });

    await this.wbClustersRepository.upsertDailyPrices(rows);
    this.logger.log(`Prices sync done: ${rows.length} products saved for ${priceDate}`);
  }

  /** Returns the latest price per nmId (price with seller discount). */
  async getLatestPrices(): Promise<{ nmId: number; price: number; discount: number }[]> {
    if (!this.wbClustersRepository.isConfigured()) return [];
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getLatestPrices();
  }

  /** Returns the full prices matrix (all dates × all products) for the frontend. */
  async getPricesMatrix(): Promise<{ nmId: number; priceDate: string; price: number; discount: number }[]> {
    if (!this.wbClustersRepository.isConfigured()) return [];
    await this.wbClustersRepository.ensureSchema();
    return this.wbClustersRepository.getPricesMatrix();
  }

  // ─── Изменение цены с записью на маркетплейс WB ──────────────────────────────
  //
  // ⚠️ ОПАСНО: реально меняет цену на витрине WB. Вызывается ТОЛЬКО из явного
  // PUT .../price (действие пользователя) — ни один крон/синк сюда не заходит.
  // Скидку НЕ трогаем: двигаем только базовую цену под целевой итог «со скидкой».
  // No-op guard: если новая база совпала с текущей — в WB ничего не отправляем.

  private finalFromBase(base: number, discount: number): number {
    return Math.round(base * (1 - discount / 100) * 100) / 100;
  }

  /** Запрашивает изменение цены товара и отправляет его на маркетплейс WB. */
  async setProductPrice(nmId: number, targetFinal: number) {
    // Read-only (миграция): ручная смена цены не уходит в чужой боевой кабинет WB. Понятная
    // ошибка вместо «висящей» отправки — UI покажет, что экземпляр в режиме наблюдения.
    if (appEnv.wbAutomationReadOnly) {
      throw new Error("Изменение цены недоступно: сервер в режиме наблюдения (read-only).");
    }
    if (!this.wbClustersRepository.isConfigured()) {
      throw new Error("PostgreSQL не настроен.");
    }
    if (!Number.isFinite(targetFinal) || targetFinal <= 0) {
      throw new Error("Некорректная цена.");
    }
    await this.wbClustersRepository.ensureSchema();

    const latest = await this.wbClustersRepository.getLatestPrices();
    const current = latest.find((p) => p.nmId === nmId);
    if (!current) {
      throw new Error(`Нет текущей цены для товара #${String(nmId)} — сначала синхронизируйте цены.`);
    }
    const discount = current.discount;
    const currentBase = current.price;
    const currentFinal = this.finalFromBase(currentBase, discount);

    // Обратный пересчёт: целевой итог → целая базовая цена (скидка неизменна).
    // WB принимает только целую базу; фактическую цену «со скидкой» он считает сам
    // как base × (1 − discount/100) — она получается с копейками. Фиксируем именно
    // эту реальную цену (с копейками), а не округлённое введённое значение, чтобы
    // ячейка показывала ровно то, что установит WB.
    const newBase = Math.round(targetFinal / (1 - discount / 100));
    const actualFinal = this.finalFromBase(newBase, discount);

    const result = {
      nmId,
      desiredBasePrice: newBase,
      desiredDiscount: discount,
      desiredFinal: actualFinal,
      currentBasePrice: currentBase,
      currentFinal,
      lastError: null as string | null,
    };

    // Никакого no-op по снапшоту: пользователь может выставить любое значение
    // (в т.ч. равное исходной цене до правок) — оно должно примениться. Защита от
    // повторной отправки того же числа живёт на фронте (сравнение с тем, что в ячейке).

    await this.wbClustersRepository.upsertPriceChangeQueued({
      nmId,
      basePrice: newBase,
      discount,
      finalPrice: actualFinal,
    });

    this.wbClustersRepository
      .saveSystemChangeLogEntry({
        entityType: "price",
        nmId,
        entityLabel: `Товар #${String(nmId)}`,
        changeType: "set",
        oldValue: `${currentFinal.toFixed(2)} ₽ (база ${String(currentBase)})`,
        newValue: `${actualFinal.toFixed(2)} ₽ (база ${String(newBase)})`,
      })
      .catch(() => {/* non-critical */});

    try {
      const uploadId = await this.pricesApiClient.uploadPrice(nmId, newBase, discount);
      await this.wbClustersRepository.updatePriceChange(nmId, { syncStatus: "sending", uploadId });
      return { ...result, status: "sending" as const };
    } catch (err) {
      const message = (err as Error).message || "Ошибка отправки в WB";
      await this.wbClustersRepository.updatePriceChange(nmId, { syncStatus: "failed", lastError: message });
      this.logger.warn(`setProductPrice WB upload failed for ${String(nmId)}: ${message}`);
      return { ...result, status: "failed" as const, lastError: message };
    }
  }

  /**
   * Последние выставленные пользователем цены (overlay для таблицы) — чтобы ячейка
   * сразу и после перезагрузки показывала введённое значение. Без статусов/проверок:
   * по договорённости мы доверяем, что WB применяет цену, и не делаем readback.
   */
  async getProductPriceChangeStatuses() {
    if (!this.wbClustersRepository.isConfigured()) return { items: [] };
    await this.wbClustersRepository.ensureSchema();
    const items = await this.wbClustersRepository.getPriceChangeRows();
    return { items };
  }

  /** Nightly snapshot: copies each product's latest cost price into today's row (idempotent). */
  async snapshotCostPricesToday(): Promise<void> {
    if (!this.wbClustersRepository.isConfigured()) return;
    await this.wbClustersRepository.ensureSchema();
    const inserted = await this.wbClustersRepository.snapshotLatestCostPricesToToday();
    this.logger.log(`Cost price daily snapshot: ${inserted} rows inserted.`);
  }

}
