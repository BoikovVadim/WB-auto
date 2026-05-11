import { Injectable } from "@nestjs/common";

import { normalizeProductAdvertisingSheetResponse } from "./product-advertising-sheet.contract";
import { withProductAdvertisingSnapshotMeta } from "./product-advertising-sheet.response";
import { withProductAdvertisingRange } from "./product-advertising-sheet.snapshot";
import { ProductAdvertisingSnapshotRepository } from "./product-advertising-snapshot.repository";
import { ProductWorkspaceSnapshotMaterializer } from "./product-workspace-snapshot.materializer";
import type { ProductAdvertisingSheetResponse } from "./wb-clusters.types";

@Injectable()
export class ProductAdvertisingSnapshotMaterializer {
  constructor(
    private readonly productAdvertisingSnapshotRepository: ProductAdvertisingSnapshotRepository,
    private readonly productWorkspaceSnapshotMaterializer: ProductWorkspaceSnapshotMaterializer,
  ) {}

  async materializeExactSnapshot(input: {
    nmId: number;
    currentPeriod: { start: string; end: string };
    schemaVersion: number;
    builtFromExportRequestId?: string | null;
    sourceKind?: string;
    buildReadySheet: () => Promise<ProductAdvertisingSheetResponse>;
  }) {
    const builtAt = new Date().toISOString();
    const snapshot = withProductAdvertisingSnapshotMeta(
      withProductAdvertisingRange(await input.buildReadySheet(), {
        startDate: input.currentPeriod.start,
        endDate: input.currentPeriod.end,
        jamIncluded: true,
        jamStatus: "ready",
      }),
      {
        status: "ready",
        fit: "exact",
        source: "exact_snapshot",
        builtAt,
        requestedStartDate: input.currentPeriod.start,
        requestedEndDate: input.currentPeriod.end,
        snapshotStartDate: input.currentPeriod.start,
        snapshotEndDate: input.currentPeriod.end,
        builtFromExportRequestId: input.builtFromExportRequestId ?? null,
        lastError: null,
      },
    );
    const normalizedSnapshot = normalizeProductAdvertisingSheetResponse(snapshot);
    if (!normalizedSnapshot.value) {
      throw new Error(
        normalizedSnapshot.issue ??
          "Built product advertising snapshot is incompatible with the runtime contract.",
      );
    }

    await this.productAdvertisingSnapshotRepository.saveReadySnapshot({
      nmId: input.nmId,
      startDate: input.currentPeriod.start,
      endDate: input.currentPeriod.end,
      schemaVersion: input.schemaVersion,
      payload: normalizedSnapshot.value,
      builtFromExportRequestId: input.builtFromExportRequestId ?? null,
      sourceKind: input.sourceKind ?? "materialized",
      lastAttemptAt: builtAt,
    });

    await this.productWorkspaceSnapshotMaterializer.materializeFromProductSheetSnapshot({
      nmId: input.nmId,
      startDate: input.currentPeriod.start,
      endDate: input.currentPeriod.end,
      schemaVersion: input.schemaVersion,
      sheet: normalizedSnapshot.value,
    });

    return normalizedSnapshot.value;
  }
}
