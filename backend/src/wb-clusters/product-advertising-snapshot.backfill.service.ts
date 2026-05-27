import { Injectable, Logger, OnModuleInit } from "@nestjs/common";

import { ProductAdvertisingSnapshotRepository } from "./product-advertising-snapshot.repository";
import { WbClustersService } from "./wb-clusters.service";
import { productAdvertisingSheetSnapshotSchemaVersion } from "./wb-clusters.service.state";

const startupProductSnapshotBackfillDelayMs = 30_000;
const productSnapshotBackfillBatchPauseMs = 250;

@Injectable()
export class ProductAdvertisingSnapshotBackfillService implements OnModuleInit {
  private readonly logger = new Logger(ProductAdvertisingSnapshotBackfillService.name);

  constructor(
    private readonly productAdvertisingSnapshotRepository: ProductAdvertisingSnapshotRepository,
    private readonly wbClustersService: WbClustersService,
  ) {}

  onModuleInit() {
    // Startup backfill отключён: система использует SQL-direct path (source: "sql_direct"),
    // поэтому пересборка старых снапшотов при старте не нужна и вызывала OOM-краши
    // из-за параллельного парсинга огромных JSONB-полезных нагрузок.
    // Снапшоты обновляются only on explicit /products/:nmId/refresh или after sync.
    this.logger.log("Startup snapshot backfill is disabled; SQL-direct path is active.");
  }

  async backfillSnapshotsMissingCurrentSchema() {
    const batchSize = 50;
    let totalQueued = 0;

    while (true) {
      const staleSnapshots =
        await this.productAdvertisingSnapshotRepository.listReadySnapshotsMissingSchemaVersion(
          productAdvertisingSheetSnapshotSchemaVersion,
          batchSize,
        );
      if (staleSnapshots.length === 0) {
        break;
      }

      const nmIdsByPeriod = new Map<string, number[]>();
      for (const snapshot of staleSnapshots) {
        const key = `${snapshot.startDate}:${snapshot.endDate}`;
        const currentNmIds = nmIdsByPeriod.get(key) ?? [];
        if (!currentNmIds.includes(snapshot.nmId)) {
          currentNmIds.push(snapshot.nmId);
        }
        nmIdsByPeriod.set(key, currentNmIds);
      }

      for (const [periodKey, nmIds] of nmIdsByPeriod.entries()) {
        const [startDate, endDate] = periodKey.split(":");
        await this.wbClustersService.materializeProductAdvertisingSheetsForNmIds(
          nmIds,
          "startup-schema-backfill",
          undefined,
          startDate,
          endDate,
          "background",
        );
      }

      totalQueued += staleSnapshots.length;
      if (staleSnapshots.length < batchSize) {
        break;
      }

      await wait(productSnapshotBackfillBatchPauseMs);
    }

    if (totalQueued > 0) {
      this.logger.log(
        `Queued ${totalQueued} stale product advertising snapshots for schema backfill.`,
      );
    }
  }
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
