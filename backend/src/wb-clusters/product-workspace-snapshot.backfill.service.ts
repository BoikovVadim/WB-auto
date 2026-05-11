import { Injectable, Logger, OnModuleInit } from "@nestjs/common";

import { ProductWorkspaceRepository } from "./product-workspace.repository";
import { ProductWorkspaceSnapshotMaterializer } from "./product-workspace-snapshot.materializer";

const startupWorkspaceBackfillDelayMs = 30_000;
const workspaceBackfillBatchPauseMs = 250;

@Injectable()
export class ProductWorkspaceSnapshotBackfillService implements OnModuleInit {
  private readonly logger = new Logger(ProductWorkspaceSnapshotBackfillService.name);

  constructor(
    private readonly productWorkspaceRepository: ProductWorkspaceRepository,
    private readonly productWorkspaceSnapshotMaterializer: ProductWorkspaceSnapshotMaterializer,
  ) {}

  onModuleInit() {
    windowSafeSetTimeout(() => {
      void this.backfillMissingWorkspaceSnapshots().catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Unknown workspace snapshot backfill error";
        this.logger.error(`Unable to backfill workspace snapshots on startup: ${message}`);
      });
    }, startupWorkspaceBackfillDelayMs);
  }

  async backfillMissingWorkspaceSnapshots() {
    const batchSize = 100;

    while (true) {
      const missingSnapshots =
        await this.productWorkspaceRepository.listReadySheetSnapshotsMissingWorkspace(batchSize);
      if (missingSnapshots.length === 0) {
        return;
      }

      for (const snapshot of missingSnapshots) {
        await this.productWorkspaceSnapshotMaterializer.materializeFromProductSheetSnapshot({
          nmId: snapshot.nmId,
          startDate: snapshot.startDate,
          endDate: snapshot.endDate,
          schemaVersion: snapshot.schemaVersion,
          sheet: snapshot.payload,
        });
      }

      this.logger.log(`Backfilled ${missingSnapshots.length} workspace snapshots from ready sheet snapshots.`);

      if (missingSnapshots.length < batchSize) {
        return;
      }

      await wait(workspaceBackfillBatchPauseMs);
    }
  }
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function windowSafeSetTimeout(callback: () => void, delayMs: number) {
  setTimeout(callback, delayMs);
}
