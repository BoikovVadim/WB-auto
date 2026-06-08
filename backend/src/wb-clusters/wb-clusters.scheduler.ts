import { spawn } from "node:child_process";
import path from "node:path";

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { appEnv } from "../common/env";
import { AcquiringSyncService } from "./acquiring-sync.service";
import { ProductCatalogService } from "./product-catalog.service";
import { ProductClusterAccrualService } from "./product-cluster-accrual.service";
import { ProductClusterAutomationService } from "./product-cluster-automation.service";
import { ProductClusterBidEngineService } from "./product-cluster-bid-engine.service";
import { ProductDrrRegulatorService } from "./product-drr-regulator.service";
import { UnitEconomicsService } from "./unit-economics.service";
import { WbClustersService } from "./wb-clusters.service";

@Injectable()
export class WbClustersScheduler implements OnModuleInit {
  private readonly logger = new Logger(WbClustersScheduler.name);

  constructor(
    private readonly wbClustersService: WbClustersService,
    private readonly productCatalogService: ProductCatalogService,
    private readonly acquiringSyncService: AcquiringSyncService,
    private readonly unitEconomicsService: UnitEconomicsService,
    private readonly productClusterAutomationService: ProductClusterAutomationService,
    private readonly productClusterAccrualService: ProductClusterAccrualService,
    private readonly productClusterBidEngineService: ProductClusterBidEngineService,
    private readonly productDrrRegulatorService: ProductDrrRegulatorService,
  ) {}

  async onModuleInit() {
    this.productCatalogService
      .syncMissingVendorCodesFromContentApi()
      .then(() =>
        this.productCatalogService
          .syncCategoryNames()
          .catch((err: Error) => this.logger.warn(`onModuleInit category sync error: ${err.message}`)),
      )
      .catch((err: Error) => this.logger.warn(`onModuleInit vendor sync error: ${err.message}`));
    // No on-boot warmup. Eagerly loading the 300k-row query-frequencies array
    // into the in-memory cache on every PM2 restart pushed RSS past the 900M
    // max_memory_restart limit, which triggered a restart that re-ran the
    // warmup — a self-reinforcing crash loop (~470 restarts/day). The frequency
    // download itself stays on its weekly Sunday cron; the in-memory cache now
    // fills lazily on the first browser request and lives its normal 65-min TTL.
    // (triggerStartupWarmup is also a no-op — bulk materialization on boot was
    // disabled earlier for the same OOM reason; see WbClustersService.)
    this.logger.log(
      "JAM boot backfill is disabled; nightly cron and explicit manual backfill remain active.",
    );
  }

  // Single 5-second tick drives all three queue processors sequentially.
  // Previously three separate 1-second crons woke Nest 3× per second even
  // when queues were empty; one 5-second cron is sufficient for interactive
  // bid/action latency and cuts idle CPU by ~3×.
  @Cron("*/5 * * * * *")
  async handleQueuePass() {
    await this.wbClustersService.handleClusterBidQueue().catch((err: Error) => {
      this.logger.warn(`handleClusterBidQueue error: ${err.message}`);
    });
    await this.wbClustersService.handleClusterActionQueue().catch((err: Error) => {
      this.logger.warn(`handleClusterActionQueue error: ${err.message}`);
    });
    await this.wbClustersService.handleClusterBidReconcileQueue().catch((err: Error) => {
      this.logger.warn(`handleClusterBidReconcileQueue error: ${err.message}`);
    });
  }

  @Cron("*/15 * * * * *")
  async handleProductPresetSnapshotQueue() {
    await this.wbClustersService.handleProductPresetSnapshotQueue();
  }

  // Автоматизация управления кластерами по CPO: каждые 10 минут пересчёт решений
  // для кампаний с включённой автоматизацией (preview — без записи в WB, live — с записью).
  @Cron("0 */10 * * * *")
  async handleClusterAutomation() {
    await this.productClusterAutomationService.runAll().catch((err: Error) => {
      this.logger.warn(`handleClusterAutomation error: ${err.message}`);
    });
  }

  // Ежедневный JAM-синк по ВСЕМ товарам в разрезе «заказы», батчами по 50 nmId (быстро:
  // ~18 мин на все товары вместо ~74 мин по-товарной финализации). Полное подневное покрытие
  // для накопительных счётчиков. Раз в сутки в 03:00 МСК (после ночного JAM-синка 01:00).
  // Переиспользует протестированный батчевый скрипт (dist/.../fill-jam-daily-backfill.js) за
  // ВЧЕРА — resume-safe, не дублирует логику парсинга/throttle. Не трогает старый ночной синк.
  @Cron("0 0 3 * * *")
  handleDailyJamAllProducts() {
    const d = new Date(); // сервер в TZ Europe/Moscow → компоненты = МСК
    d.setDate(d.getDate() - 1);
    const yday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    this.runJamAllProductsForRange(yday, yday);
  }

  /** Запускает батчевый JAM-бэкфилл-скрипт за диапазон дат отдельным процессом (тяжёлый job). */
  private runJamAllProductsForRange(fromDate: string, toDate: string): void {
    const script = path.join(__dirname, "fill-jam-daily-backfill.js");
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, WB_JAM_BACKFILL_FROM: fromDate, WB_JAM_BACKFILL_TO: toDate },
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.on("error", (err) => this.logger.warn(`jam-daily spawn error: ${err.message}`));
    child.on("exit", (code) =>
      this.logger.log(`jam-daily ${fromDate}..${toDate} завершён, код ${code}`),
    );
  }

  // Регулятор дневного ДРР (этап 1E) — раз в сутки в 06:30 МСК (после аккумулятора 05:45,
  // когда накопители и вчерашние ДРР/выручка готовы). Держит ДРР товара у плана, двигая
  // линию отсечки (ставит/снимает drr_held). Работает только при флагах v2 + DRR_REGULATOR;
  // применение на WB — через следующий v2-крон. cron "0 30 6" в TZ Europe/Moscow.
  @Cron("0 30 6 * * *")
  async handleDrrRegulator() {
    await this.productDrrRegulatorService.runDailyForAll().catch((err: Error) => {
      this.logger.warn(`handleDrrRegulator error: ${err.message}`);
    });
  }

  // Ставочный движок (этап 3) — позиционный регулятор ставок CPM, круг каждые 10 мин
  // (busy-guard: длинный круг не накладывается). По умолчанию НЕ работает: нужен флаг
  // WB_CLUSTER_BID_ENGINE=1 + непустой scope WB_CLUSTER_BID_NMIDS. Применение к WB только в
  // scope и не в dry-run. Старт сдвинут на +30с от движка решений (тот на "0 */10"), чтобы два
  // тяжёлых обхода не били БД/WB в одну секунду. cron в TZ Europe/Moscow. См. bid-engine.service.
  @Cron("30 */10 * * * *")
  async handleBidEngine() {
    await this.productClusterBidEngineService.runCycle().catch((err: Error) => {
      this.logger.warn(`handleBidEngine error: ${err.message}`);
    });
  }

  // Накопительные счётчики кластеров (этап 1A новой логики) — раз в сутки в 05:45 МСК
  // (cron "0 45 5" в TZ Europe/Moscow), после финализации заказов/расхода/JAM за вчера.
  // Прибавляет вчерашний день в ценовые корзины. Идемпотентно (guard last_accrued_date).
  @Cron("0 45 5 * * *")
  async handleClusterAccrual() {
    await this.productClusterAccrualService.accrueYesterdayForAll().catch((err: Error) => {
      this.logger.warn(`handleClusterAccrual error: ${err.message}`);
    });
  }

  // Prune expired in-memory cache entries every 5 minutes to prevent
  // unbounded Map growth during long-running server sessions.
  @Cron("0 */5 * * * *")
  handleCachePrune() {
    this.wbClustersService.handleCachePrune();
  }

  @Cron(appEnv.wbPromotionSyncCron)
  async handleScheduledSync() {
    await this.wbClustersService.handleScheduledSync();
  }

  @Cron(appEnv.wbPromotionJamSyncCron)
  async handleScheduledJamSync() {
    await this.wbClustersService.handleScheduledJamSync();
  }

  @Cron(appEnv.wbPromotionMonthlyFrequencySyncCron)
  async handleScheduledMonthlyFrequencySync() {
    await this.wbClustersService.handleScheduledMonthlyFrequencySync();
  }

  // Re-sync vendor codes from WB Content API once a day at 07:00 Moscow (04:00 UTC).
  @Cron("0 0 4 * * *")
  async handleVendorCodeSync() {
    await this.productCatalogService.syncMissingVendorCodesFromContentApi();
    await this.productCatalogService
      .syncCategoryNames()
      .catch((err: Error) => this.logger.warn(`handleVendorCodeSync category sync error: ${err.message}`));
  }

  // Ночной пре-компьютинг в 22:30 МСК. Сервер в TZ Europe/Moscow → cron-строка
  // трактуется как МСК (cron-строка "0 30 22" = 22:30 МСК). Раньше стояло "0 30 19"
  // с пометкой "22:30 МСК (19:30 UTC)" — ошибочной: при московской TZ это срабатывало
  // в 19:30 МСК (вечерний пик), а тяжёлый bulk-прогон по всем товарам пробивал heap
  // и ронял бэкенд FATAL OOM. Сборки теперь идут серийно (priority "precompute",
  // concurrency 1), а окно сдвинуто на тихие 22:30.
  // Заранее материализует 7-дневный диапазон следующего дня для всех товаров,
  // чтобы утром пользователь видел данные мгновенно без ожидания фоновой очереди.
  @Cron("0 30 22 * * *")
  async handlePrecomputeNextDayPeriod() {
    await this.wbClustersService
      .precomputeNextDayPeriod()
      .catch((err: Error) => this.logger.warn(`Ночной пре-компьютинг: ошибка: ${err.message}`));
  }

  // Daily cost price snapshot at 21:01 MSK (cron "0 1 21" in TZ Europe/Moscow).
  // NB: исполняется вечером в 21:01 МСК, а не в начале суток — наследие UTC-эпохи
  // ("0 1 21" задумывался как 21:01 UTC = 00:01 МСК след. дня). Функционально не
  // ломает: ON CONFLICT DO NOTHING + берётся самая свежая с/с, строка пишется на
  // текущую дату. Если нужен снапшот ровно в полночь — сменить cron на "0 1 0".
  // Copies each product's most recent cost price into today's date row so that
  // the retrospective history grows automatically without user action.
  // Uses ON CONFLICT DO NOTHING — safe if run more than once per day.
  @Cron("0 1 21 * * *")
  async handleCostPriceDailySnapshot() {
    await this.wbClustersService
      .snapshotCostPricesToday()
      .catch((err: Error) => this.logger.warn(`Cost price snapshot error: ${err.message}`));
  }

  // ─── Orders (Analytics CSV — for past days only) ─────────────────────────────
  //
  // WB Analytics API лимит: 20 POST-запросов в сутки на создание отчёта.
  // Раньше почасовая синка съедала 24+ → 429 с середины дня.
  //
  // Новая схема:
  //   - CSV (Analytics) только ночью: финализация вчера (02:00 МСК) + год-бэкфилл (03:30 МСК).
  //     Сегодня CSV намеренно НЕ перезаписывает (CASE WHEN в upsert и фильтр в clear).
  //   - Сегодня тянет Sales Funnel (Воронка) — часовой крон
  //     handleOrdersTodayFromSalesFunnel ниже (совпадает с кабинетом WB).
  //   - Прошлые дни в CSV не меняются после финализации, обновлять чаще раза в сутки смысла нет.

  /**
   * Раз в сутки в 00:30 МСК (cron "0 30 0" в TZ Europe/Moscow): сверка с CSV за КОРОТКОЕ окно последних
   * N дней (WB_ORDERS_RECONCILE_DAYS, по умолчанию 30). WB доуточняет заказы/выкупы
   * за день ~2 недели — этого окна с запасом хватает, а короткий отчёт генерится за
   * секунды и почти не ловит 429 на поллинге (в отличие от годового). diff-aware
   * upsert трогает только реально изменившиеся дни. Полный год тянем не здесь, а
   * разово через эндпоинт products/sync-orders-year (первая установка / пропуски).
   */
  @Cron("0 30 0 * * *")
  async handleOrdersRecentReconcile() {
    if (!appEnv.wbOrdersSyncEnabled) return;
    await this.wbClustersService
      .syncOrdersFromAnalyticsFullYear(appEnv.wbOrdersReconcileDays)
      .catch((err: Error) => this.logger.warn(`Orders recent reconcile error: ${err.message}`));
  }

  /**
   * Раз в сутки в 00:40 МСК (cron "0 40 0" в TZ Europe/Moscow): фиксируем итоговый
   * % выкупа за вчера (плавающее окно 365 дней, заканчивающееся вчерашним днём).
   * Запускается через 10 минут после сверки заказов (00:30), когда WB закрыл день.
   * Эта строка становится неизменной исторической записью — финал закрытого дня.
   * Карточка товаров читает самый свежий snapshot одним SELECT'ом — мгновенно.
   */
  @Cron("0 40 0 * * *")
  async handleBuyoutPercentSnapshot() {
    if (!appEnv.wbOrdersSyncEnabled) return;
    await this.wbClustersService
      .snapshotBuyoutsRolling(365)
      .catch((err: Error) => this.logger.warn(`Buyout-percent snapshot error: ${err.message}`));
  }

  /**
   * Раз в сутки в 00:45 МСК (cron "0 45 0" в TZ Europe/Moscow): фиксируем «С/с продаж» за вчера
   * (заказы × % выкупа × себестоимость). Запускается через 5 минут после снапшота
   * % выкупа (00:40) — он нужен как источник того же выкупа, что и у «Выручки».
   * Серия копится вперёд от момента запуска; backfill истории не делаем.
   */
  @Cron("0 45 0 * * *")
  async handleCostSumSnapshot() {
    if (!appEnv.wbOrdersSyncEnabled) return;
    await this.wbClustersService
      .snapshotCostSumForYesterday()
      .catch((err: Error) => this.logger.warn(`Cost-sum snapshot error: ${err.message}`));
  }

  /** В 02:00 МСК (по умолчанию): финализируем вчера через CSV. Сегодня в
   *  clear/upsert не трогается. Сервер в Europe/Moscow → cron-строка трактуется
   *  как МСК; раньше дефолт стоял "0 0 23 * * *" с пометкой "23 UTC = 02 МСК",
   *  но это срабатывало в 23:00 МСК и упиралось в дневной 429 от Analytics API. */
  @Cron(appEnv.wbOrdersFinalizeCron)
  async handleOrdersFinalize() {
    if (!appEnv.wbOrdersSyncEnabled) return;
    await this.wbClustersService
      .syncOrdersFromAnalytics(1)
      .catch((err: Error) => this.logger.warn(`Orders finalize error: ${err.message}`));
  }

  private sppTodaySyncRunning = false;

  /**
   * Запускает СПП-синк под общим мьютексом sppTodaySyncRunning: today-sync и ночная
   * финализация вчера не должны идти параллельно (оба читают Statistics API с лимитом
   * 1 req/min). Если предыдущий прогон ещё идёт — тик пропускается и логируется под
   * своим label. Снимает копипасту wbOrdersSyncEnabled + guard + try/catch/finally.
   */
  private async runSppGuarded(label: string, fn: () => Promise<void>): Promise<void> {
    if (!appEnv.wbOrdersSyncEnabled) return;
    if (this.sppTodaySyncRunning) {
      this.logger.warn(`${label}: предыдущий прогон ещё идёт, пропускаю тик.`);
      return;
    }
    this.sppTodaySyncRunning = true;
    try {
      await fn();
    } catch (err) {
      this.logger.warn(`${label} error: ${(err as Error).message}`);
    } finally {
      this.sppTodaySyncRunning = false;
    }
  }

  /**
   * Освежаем СПП (среднюю скидку постоянного покупателя) за СЕГОДНЯ каждый час
   * (в начале каждого часа по МСК). spp есть только в Statistics API (лимит ~1 req/min,
   * а запрос на день один), поэтому считать на лету на каждый рендер нельзя — крон
   * пишет в wb_product_spp_daily, фронт читает готовые строки. Наложение с ночной
   * финализацией / бэкфиллом страхует общий мьютекс в runSppGuarded.
   */
  @Cron("0 0 * * * *")
  async handleSppTodaySync() {
    await this.runSppGuarded("SPP today sync", () => this.wbClustersService.syncSppToday());
  }

  /**
   * В 00:55 МСК добиваем СПП за вчера: последний часовой проход (00:00) уже считает
   * сегодня, а вчерашний день только что закрылся — финальный проход фиксирует его
   * целиком. Эта строка уходит в ретроспективу (матрица читает spp_date < сегодня).
   */
  @Cron("0 55 0 * * *")
  async handleSppFinalizeYesterday() {
    await this.runSppGuarded("SPP finalize", () => this.wbClustersService.syncSppYesterday());
  }

  private ordersTodaySyncRunning = false;

  /**
   * Освежаем СЕГОДНЯ через Sales Funnel (Воронку, /products) — orderCount/orderSum/
   * cancelCount совпадают с кабинетом WB «Заказали товаров», в отличие от Statistics
   * API (тот выкидывал заказы с неподтверждённой оплатой → недосчёт ~12%). Все
   * активные товары приходят за один запрос, прогон занимает секунды — cron каждые
   * 15 мин (см. wbOrdersSyncCron). Гард ordersTodaySyncRunning страхует от наложения.
   * Частоту можно переопределить через WB_ORDERS_SYNC_CRON.
   */
  @Cron(appEnv.wbOrdersSyncCron)
  async handleOrdersTodayFromSalesFunnel() {
    if (!appEnv.wbOrdersSyncEnabled) return;
    if (this.ordersTodaySyncRunning) {
      this.logger.warn("Orders Sales Funnel sync: предыдущий прогон ещё идёт, пропускаю тик.");
      return;
    }
    this.ordersTodaySyncRunning = true;
    try {
      await this.wbClustersService.syncOrdersTodayFromSalesFunnel();
    } catch (err) {
      this.logger.warn(`Orders Sales Funnel sync error: ${(err as Error).message}`);
    } finally {
      this.ordersTodaySyncRunning = false;
    }
  }


  private adSpendFullstatsSyncRunning = false;

  /**
   * Раз в час (в начале часа МСК) тянем ПОЛНЫЙ расход рекламы из WB GET /adv/v3/fullstats
   * (как в кабинете) в wb_advert_daily_spend. Отдельно от основного 10-мин синка:
   * у fullstats суточный лимит (~200 запросов/аккаунт) и максимум 50 кампаний за
   * запрос. Чтобы уложиться, синк сначала через /adv/v1/upd отбирает только реально
   * тративших РК. Гард adSpendFullstatsSyncRunning страхует от наложения прогонов.
   */
  @Cron(appEnv.wbPromotionFullstatsSyncCron)
  async handleAdSpendFullstatsSync() {
    if (!appEnv.wbPromotionSyncEnabled) return;
    if (this.adSpendFullstatsSyncRunning) {
      this.logger.warn("Ad-spend fullstats sync: предыдущий прогон ещё идёт, пропускаю тик.");
      return;
    }
    this.adSpendFullstatsSyncRunning = true;
    try {
      await this.wbClustersService.syncAdSpendFromFullstats();
    } catch (err) {
      this.logger.warn(`Ad-spend fullstats sync error: ${(err as Error).message}`);
    } finally {
      this.adSpendFullstatsSyncRunning = false;
    }
  }

  // ─── Stocks snapshot ─────────────────────────────────────────────────────────
  //
  // Раз в сутки в 01:00 МСК (дефолт WB_STOCKS_SNAPSHOT_CRON). Сервер в Europe/Moscow →
  // cron-строка трактуется как МСК, НЕ UTC; прежний "0 0 22 * * *" с пометкой «22:00 UTC»
  // на деле срабатывал в 22:00 МСК.
  // Downloads /api/v1/supplier/stocks from WB Statistics API,
  // aggregates quantity by nmId across all warehouses,
  // and writes one row per product into wb_product_daily_stocks.

  @Cron(appEnv.wbStocksSnapshotCron)
  async handleStocksSnapshot() {
    await this.wbClustersService
      .syncStocksSnapshot()
      .catch((err: Error) => this.logger.warn(`Stocks snapshot error: ${err.message}`));
  }

  // ─── Prices snapshot ─────────────────────────────────────────────────────────
  //
  // Раз в сутки в 01:05 МСК. Сервер живёт в Europe/Moscow, поэтому cron-строка — это
  // МСК напрямую, НЕ UTC. Прежнее "5 22 * * *" с пометкой «22:05 UTC = 01:05 МСК» на
  // самом деле срабатывало в 22:05 МСК: снапшот за день писался поздно вечером, и почти
  // все сутки активный столбец ретроспективы (= MAX(price_date)) показывал вчера.
  // Скачивает текущие цены и скидки из WB Prices API, пишет строку на товар в
  // wb_product_daily_prices.

  @Cron("0 5 1 * * *")
  async handlePricesSnapshot() {
    await this.wbClustersService
      .syncPricesFromWb()
      .catch((err: Error) => this.logger.warn(`Prices snapshot error: ${err.message}`));
  }

  // ─── Acquiring (отчёт о реализации — фактический эквайринг по товару) ─────────
  //
  // Раз в сутки в 05:07 МСК тянем эквайринг из WB /api/v5/supplier/reportDetailByPeriod
  // в wb_product_acquiring_weekly (агрегат по nm_id × отчётной неделе). Юнит-экономика
  // берёт последнюю закрытую неделю как фактический % эквайринга по товару.
  // Время 05:07 «тихое»: orders идут :00/:15/:30/:45, spp — в :00, stocks/prices ночью,
  // поэтому не делим лимит statistics-api (1 req/min) с другими синками.
  @Cron("0 7 5 * * *")
  async handleAcquiringSync() {
    await this.acquiringSyncService
      .syncAcquiringFromRealization()
      .catch((err: Error) => this.logger.warn(`Acquiring sync error: ${err.message}`));
  }

  // ─── Маржа (дневной снапшот ретроспективы) ───────────────────────────────────
  //
  // Раз в сутки в 05:30 МСК фиксируем маржу за вчера (₽/%) той же формулой, что и колонка.
  // После синка эквайринга (05:07), чтобы взять самый свежий фактический % эквайринга.
  // Серия копится вперёд от запуска; backfill истории не делаем (маржа зависит от текущих
  // настроек/цены/с-с). «Сегодня» считается на лету в сервисе, в снапшоте его нет.
  @Cron("0 30 5 * * *")
  async handleMarginSnapshot() {
    await this.unitEconomicsService
      .materializeMarginSnapshotForYesterday()
      .catch((err: Error) => this.logger.warn(`Margin snapshot error: ${err.message}`));
  }
}
