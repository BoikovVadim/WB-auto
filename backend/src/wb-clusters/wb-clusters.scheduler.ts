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

  // ─── Orders (Analytics CSV) ──────────────────────────────────────────────────
  //
  // How accumulation works:
  //   - Every hour: refresh last 7 days (upsert, old data preserved)
  //   - At 02:00 МСК: finalize the day — WB closes yesterday by ~01:00 МСК
  //   - Result: wb_product_daily_orders grows by 1 row per product each day
  //
  // Data source: DETAIL_HISTORY_REPORT CSV (one request, all products × 7 days)

  /** Every hour: refresh today's running total from WB Analytics CSV. */
  @Cron(appEnv.wbOrdersSyncCron)
  async handleOrdersSync() {
    if (!appEnv.wbOrdersSyncEnabled) return;
    await this.wbClustersService
      .syncOrdersFromAnalytics(0)
      .catch((err: Error) => this.logger.warn(`Orders sync error: ${err.message}`));
  }

  /** At 02:00 МСК (23:00 UTC): sync yesterday + today to finalize the previous day. */
  @Cron(appEnv.wbOrdersFinalizeCron)
  async handleOrdersFinalize() {
    if (!appEnv.wbOrdersSyncEnabled) return;
    await this.wbClustersService
      .syncOrdersFromAnalytics(1)
      .catch((err: Error) => this.logger.warn(`Orders finalize error: ${err.message}`));
  }
}
