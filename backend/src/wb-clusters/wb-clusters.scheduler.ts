import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { appEnv } from "../common/env";
import { ProductCatalogService } from "./product-catalog.service";
import { WbClustersService } from "./wb-clusters.service";

@Injectable()
export class WbClustersScheduler implements OnModuleInit {
  private readonly logger = new Logger(WbClustersScheduler.name);

  constructor(
    private readonly wbClustersService: WbClustersService,
    private readonly productCatalogService: ProductCatalogService,
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
    // Warm query-frequencies in-memory cache 30 s after boot so that the first
    // browser request is served from memory rather than hitting the DB cold.
    setTimeout(() => {
      this.wbClustersService
        .getRawQueryFrequencies(300_000)
        .then((rows) => this.logger.log(`Query frequencies cache warmed: ${rows.length} rows`))
        .catch((err: Error) => this.logger.warn(`Query frequencies warmup error: ${err.message}`));
    }, 30_000);
    // Startup warmup re-enabled (May 2026). setImmediate yields added to PATH B
    // prevent the event loop from blocking and give GC time to reclaim memory
    // between batches. Concurrency is "startup" priority = 1 product at a time,
    // so the DB pool and HTTP handlers remain responsive throughout.
    // 5-minute delay lets crash recovery, schema init and backfill finish first.
    setTimeout(() => {
      this.wbClustersService
        .triggerStartupWarmup()
        .catch((err: Error) => this.logger.warn(`Startup warmup error: ${err.message}`));
    }, 5 * 60 * 1000);
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

  // Ночной пре-компьютинг в 22:30 МСК (19:30 UTC).
  // Заранее материализует 7-дневный диапазон следующего дня для всех товаров,
  // чтобы утром пользователь видел данные мгновенно без ожидания фоновой очереди.
  @Cron("0 30 19 * * *")
  async handlePrecomputeNextDayPeriod() {
    await this.wbClustersService
      .precomputeNextDayPeriod()
      .catch((err: Error) => this.logger.warn(`Ночной пре-компьютинг: ошибка: ${err.message}`));
  }

  // Daily cost price snapshot at 00:01 MSK (21:01 UTC previous day).
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
  //   - Сегодня в реальном времени тянет Statistics API — почасовой крон
  //     handleOrdersTodayFromStatsApi ниже. У него лимит per-second, не per-day.
  //   - Прошлые дни в CSV не меняются после финализации, обновлять чаще раза в сутки смысла нет.

  /**
   * Раз в сутки в 03:30 МСК (00:30 UTC): сверка с CSV за КОРОТКОЕ окно последних
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
   * Раз в сутки в 03:40 МСК (00:40 UTC): фиксируем итоговый % выкупа за вчера
   * (плавающее окно 365 дней, заканчивающееся вчерашним днём). Запускается
   * через 10 минут после полной перезаливки заказов, когда WB уже закрыл день.
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

  /**
   * Каждый час: освежаем сегодня через Statistics API.
   * Пишем orders_count, cancelled_count, orders_sum (finishedPrice).
   * Stats API не упирается в дневной лимит Analytics — это другая квота.
   */
  @Cron("0 0 * * * *")
  async handleOrdersTodayFromStatsApi() {
    if (!appEnv.wbOrdersSyncEnabled) return;
    await this.wbClustersService
      .syncOrdersTodayFromStatsApi()
      .catch((err: Error) => this.logger.warn(`Orders Stats today sync error: ${err.message}`));
  }


  // ─── Stocks snapshot ─────────────────────────────────────────────────────────
  //
  // Run once a day at 01:00 МСК (22:00 UTC).
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
  // Run once a day at 01:05 МСК (22:05 UTC), 5 minutes after stocks snapshot.
  // Downloads current prices and seller discounts from WB Prices API
  // and writes one row per product into wb_product_daily_prices.

  @Cron("5 22 * * *")
  async handlePricesSnapshot() {
    await this.wbClustersService
      .syncPricesFromWb()
      .catch((err: Error) => this.logger.warn(`Prices snapshot error: ${err.message}`));
  }

  // ─── Price-change reconcile ──────────────────────────────────────────────────
  //
  // Каждые 10 секунд: readback цен с WB для строк, которые пользователь поставил
  // в очередь явным изменением цены, и проставление статуса confirmed/pending/failed.
  // Частый тик — чтобы галочка ✓ приходила почти сразу после применения на WB.
  // ВАЖНО: это ТОЛЬКО подтверждение (readback). Здесь нет и не должно быть записи
  // цен в WB и заполнения очереди — иначе фон смог бы менять цены сам. Если активных
  // изменений нет, метод даже не обращается к WB.
  @Cron("*/10 * * * * *")
  async handlePriceReconcile() {
    await this.wbClustersService
      .reconcilePriceChanges()
      .catch((err: Error) => this.logger.warn(`Price reconcile error: ${err.message}`));
  }
}
