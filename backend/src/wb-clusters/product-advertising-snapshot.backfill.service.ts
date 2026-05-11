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
    setTimeout(() => {
      void this.backfillSnapshotsMissingCurrentSchema().catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Unknown product advertising snapshot backfill error";
        this.logger.error(`Unable to backfill product advertising snapshots on startup: ${message}`);
      });
    }, startupProductSnapshotBackfillDelayMs);
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
