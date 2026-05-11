import { Injectable } from "@nestjs/common";

import {
  buildIncompatibleProductAdvertisingSheetResponse,
  normalizeProductAdvertisingSheetResponse,
} from "./product-advertising-sheet.contract";
import { withProductAdvertisingRange } from "./product-advertising-sheet.snapshot";
import {
  createEmptyProductAdvertisingSheetResponse,
  withProductAdvertisingDailyStatsCoverageMeta,
  withProductAdvertisingSnapshotMeta,
} from "./product-advertising-sheet.response";
import { ProductAdvertisingSnapshotRepository } from "./product-advertising-snapshot.repository";
import type {
  ProductAdvertisingJamMaterializationStatus,
  ProductAdvertisingSheetResponse,
} from "./wb-clusters.types";
import type {
  PreferredProductAdvertisingSnapshotSummaryRecord,
  ProductAdvertisingSnapshotSummaryRecord,
  StoredProductAdvertisingSheetSnapshotRecord,
} from "./wb-clusters.repository";

@Injectable()
export class ProductAdvertisingSnapshotResolver {
  constructor(
    private readonly productAdvertisingSnapshotRepository: ProductAdvertisingSnapshotRepository,
  ) {}

  async resolve(input: {
    nmId: number;
    currentPeriod?: { start: string; end: string } | null;
    schemaVersion: number;
  }): Promise<ProductAdvertisingSheetResponse> {
    if (!input.currentPeriod) {
      const mostRecentSnapshotSummary =
        await this.productAdvertisingSnapshotRepository.getMostRecentReadySnapshotSummary(input.nmId);
      if (mostRecentSnapshotSummary) {
        const resolvedSnapshot = await this.resolveStoredSnapshotSummary({
          nmId: input.nmId,
          snapshotSummary: mostRecentSnapshotSummary,
          resolution: {
            fit: "most_recent",
            source: "most_recent_snapshot",
          },
          currentPeriod: null,
        });
        if (resolvedSnapshot) {
          return resolvedSnapshot;
        }
      }

      return this.createMissingSnapshotResponse(input.nmId, null);
    }

    const [preferredSnapshot] =
      await this.productAdvertisingSnapshotRepository.getPreferredReadySnapshotSummariesForRange({
        nmIds: [input.nmId],
        startDate: input.currentPeriod.start,
        endDate: input.currentPeriod.end,
        schemaVersion: input.schemaVersion,
      });
    if (preferredSnapshot) {
      const resolvedSnapshot = await this.resolveStoredSnapshotSummary({
        nmId: input.nmId,
        snapshotSummary: preferredSnapshot,
        resolution: {
          fit: preferredSnapshot.fit,
          source: preferredSnapshot.source,
        },
        currentPeriod: input.currentPeriod,
      });
      if (resolvedSnapshot) {
        return resolvedSnapshot;
      }
    }

    return this.createMissingSnapshotResponse(input.nmId, input.currentPeriod);
  }

  async resolveMany(input: {
    nmIds: number[];
    currentPeriod: { start: string; end: string };
    schemaVersion: number;
  }) {
    const preferredSnapshots =
      await this.productAdvertisingSnapshotRepository.getPreferredReadySnapshotSummariesForRange({
        nmIds: input.nmIds,
        startDate: input.currentPeriod.start,
        endDate: input.currentPeriod.end,
        schemaVersion: input.schemaVersion,
      });
    const preferredSnapshotByNmId = new Map(
      preferredSnapshots.map((snapshot) => [snapshot.nmId, snapshot]),
    );
    const storedSnapshots = await this.productAdvertisingSnapshotRepository.getReadySnapshotsByKeys(
      preferredSnapshots.map((snapshot) => ({
        nmId: snapshot.nmId,
        startDate: snapshot.startDate,
        endDate: snapshot.endDate,
        schemaVersion: snapshot.schemaVersion,
      })),
    );
    const storedSnapshotByKey = new Map(
      storedSnapshots.map((snapshot) => [
        this.buildSnapshotStorageKey(
          snapshot.nmId,
          snapshot.startDate,
          snapshot.endDate,
          snapshot.schemaVersion,
        ),
        snapshot,
      ]),
    );

    return Promise.all(input.nmIds.map(async (nmId) => {
      const preferredSnapshot = preferredSnapshotByNmId.get(nmId) ?? null;
      if (!preferredSnapshot) {
        return this.createMissingSnapshotResponse(nmId, input.currentPeriod);
      }

      const storedSnapshot =
        storedSnapshotByKey.get(
          this.buildSnapshotStorageKey(
            nmId,
            preferredSnapshot.startDate,
            preferredSnapshot.endDate,
            preferredSnapshot.schemaVersion,
          ),
        ) ?? null;
      if (!storedSnapshot) {
        return this.createMissingSnapshotResponse(nmId, input.currentPeriod);
      }

      return this.resolveStoredSnapshot({
        nmId,
        snapshot: storedSnapshot,
        resolution: {
          fit: preferredSnapshot.fit,
          source: preferredSnapshot.source,
        },
        currentPeriod: input.currentPeriod,
      });
    }));
  }

  attachLiveMetadata(
    sheet: ProductAdvertisingSheetResponse,
    currentPeriod: { start: string; end: string } | null,
    jamStatus: ProductAdvertisingJamMaterializationStatus,
  ): ProductAdvertisingSheetResponse {
    const hasUsableData =
      sheet.summary.campaignsCount > 0 ||
      sheet.summary.clustersCount > 0 ||
      sheet.summary.clusterQueriesCount > 0 ||
      sheet.summary.dailyStatsCount > 0;
    return withProductAdvertisingDailyStatsCoverageMeta(
      withProductAdvertisingSnapshotMeta(
      currentPeriod
        ? withProductAdvertisingRange(sheet, {
            startDate: currentPeriod.start,
            endDate: currentPeriod.end,
            jamIncluded: jamStatus === "ready",
            jamStatus,
          })
        : sheet,
      {
        status: hasUsableData || jamStatus === "ready" ? "ready" : "missing",
        fit: "live_read_model",
        source: "live_read_model",
        builtAt: sheet.checkedAt,
        requestedStartDate: currentPeriod?.start ?? null,
        requestedEndDate: currentPeriod?.end ?? null,
        snapshotStartDate: null,
        snapshotEndDate: null,
        builtFromExportRequestId: null,
        lastError: null,
      },
      ),
      {
        startDate: currentPeriod?.start ?? null,
        endDate: currentPeriod?.end ?? null,
      },
    );
  }

  private attachResolvedMetadata(
    sheet: ProductAdvertisingSheetResponse,
    resolution: {
      fit: "exact" | "latest_schema" | "closest_range" | "most_recent";
      source:
        | "exact_snapshot"
        | "latest_schema_snapshot"
        | "closest_range_snapshot"
        | "most_recent_snapshot";
    },
    currentPeriod: { start: string; end: string } | null,
    snapshotStartDate: string,
    snapshotEndDate: string,
    builtAt: string | null,
    builtFromExportRequestId: string | null,
    lastError: string | null,
  ): ProductAdvertisingSheetResponse {
    return withProductAdvertisingDailyStatsCoverageMeta(
      withProductAdvertisingSnapshotMeta(sheet, {
        status: "ready",
        fit: resolution.fit,
        source: resolution.source,
        builtAt,
        requestedStartDate: currentPeriod?.start ?? null,
        requestedEndDate: currentPeriod?.end ?? null,
        snapshotStartDate,
        snapshotEndDate,
        builtFromExportRequestId,
        lastError,
      }),
      {
        startDate: currentPeriod?.start ?? null,
        endDate: currentPeriod?.end ?? null,
      },
    );
  }

  private async resolveStoredSnapshot(input: {
    nmId: number;
    snapshot: StoredProductAdvertisingSheetSnapshotRecord;
    resolution: {
      fit: "exact" | "latest_schema" | "closest_range" | "most_recent";
      source:
        | "exact_snapshot"
        | "latest_schema_snapshot"
        | "closest_range_snapshot"
        | "most_recent_snapshot";
    };
    currentPeriod: { start: string; end: string } | null;
  }) {
    const normalizedPayload = normalizeProductAdvertisingSheetResponse(input.snapshot.payload);
    if (!normalizedPayload.value) {
      return buildIncompatibleProductAdvertisingSheetResponse({
        nmId: input.nmId,
        requestedStartDate: input.currentPeriod?.start ?? null,
        requestedEndDate: input.currentPeriod?.end ?? null,
        issue: normalizedPayload.issue,
      });
    }

    return this.attachResolvedMetadata(
      normalizedPayload.value,
      input.resolution,
      input.currentPeriod,
      input.snapshot.startDate,
      input.snapshot.endDate,
      input.snapshot.readyAt ?? input.snapshot.syncedAt,
      input.snapshot.builtFromExportRequestId,
      normalizedPayload.issue ?? input.snapshot.failureReason,
    );
  }

  private async resolveStoredSnapshotSummary(input: {
    nmId: number;
    snapshotSummary:
      | ProductAdvertisingSnapshotSummaryRecord
      | PreferredProductAdvertisingSnapshotSummaryRecord;
    resolution: {
      fit: "exact" | "latest_schema" | "closest_range" | "most_recent";
      source:
        | "exact_snapshot"
        | "latest_schema_snapshot"
        | "closest_range_snapshot"
        | "most_recent_snapshot";
    };
    currentPeriod: { start: string; end: string } | null;
  }) {
    const snapshot = await this.productAdvertisingSnapshotRepository.getReadySnapshotBySummary({
      nmId: input.nmId,
      startDate: input.snapshotSummary.startDate,
      endDate: input.snapshotSummary.endDate,
      schemaVersion: input.snapshotSummary.schemaVersion,
    });
    if (!snapshot) {
      return null;
    }

    return this.resolveStoredSnapshot({
      nmId: input.nmId,
      snapshot,
      resolution: input.resolution,
      currentPeriod: input.currentPeriod,
    });
  }

  private buildSnapshotStorageKey(
    nmId: number,
    startDate: string,
    endDate: string,
    schemaVersion: number,
  ) {
    return `${String(nmId)}:${startDate}:${endDate}:${String(schemaVersion)}`;
  }

  private createMissingSnapshotResponse(
    nmId: number,
    currentPeriod: { start: string; end: string } | null,
  ) {
    return createEmptyProductAdvertisingSheetResponse({
      nmId,
      requestedStartDate: currentPeriod?.start ?? null,
      requestedEndDate: currentPeriod?.end ?? null,
      snapshotStatus: "missing",
      snapshotFit: "unavailable",
      snapshotSource: "snapshot_store",
      lastError: "No ready product snapshot is available yet.",
    });
  }
}
