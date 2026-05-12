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
      .catch((err: Error) => this.logger.warn(`onModuleInit vendor sync error: ${err.message}`));
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

  // Daily stats finalization at 01:00 Moscow (22:00 UTC).
  // WB closes the previous Moscow calendar day at ~21:00 UTC. Running an
  // extra sync 60 minutes after that ensures finalized daily stats land in
  // the DB even if the regular 10-minute sync happened to fail around midnight.
  @Cron("0 0 22 * * *")
  async handleDayCloseStatsSync() {
    await this.wbClustersService.handleScheduledSync();
  }

  // Re-sync vendor codes from WB Content API once a day at 07:00 Moscow (04:00 UTC).
  @Cron("0 0 4 * * *")
  async handleVendorCodeSync() {
    await this.productCatalogService.syncMissingVendorCodesFromContentApi();
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
}
