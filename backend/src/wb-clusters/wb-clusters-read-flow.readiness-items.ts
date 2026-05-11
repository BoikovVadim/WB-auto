type WbClustersService = any;

import type {
  PreferredProductAdvertisingSnapshotSummaryRecord,
  ProductAdvertisingSnapshotSummaryRecord,
  ProductPresetSnapshotJobRecordSummary,
} from "./wb-clusters.repository";
import type { ProductSnapshotReadinessItem, ProductSnapshotReadinessStatus } from "./wb-clusters.types";
import type { ProductSnapshotWarmupState } from "./wb-clusters.service.state";

export async function getProductAdvertisingSheetReadiness(
  self: WbClustersService,
  input: {
    nmIds: number[];
    startDate: string;
    endDate: string;
    exportRequestId?: string;
  },
) {
  const uniqueNmIds = Array.from(
    new Set(input.nmIds.filter((value) => Number.isInteger(value) && value > 0)),
  );
  const currentPeriod = self.normalizeAdvertisingSheetJamRange(input.startDate, input.endDate);
  if (uniqueNmIds.length === 0) {
    return {
      checkedAt: new Date().toISOString(),
      exportRequestId: input.exportRequestId ?? null,
      range: {
        startDate: currentPeriod.start,
        endDate: currentPeriod.end,
      },
      items: [],
    };
  }

  const [preferredSnapshots, presetJob]: [
    PreferredProductAdvertisingSnapshotSummaryRecord[],
    ProductPresetSnapshotJobRecordSummary | null,
  ] = await Promise.all([
    self.wbClustersRepository.getPreferredReadyProductAdvertisingSnapshotSummariesForRange({
      nmIds: uniqueNmIds,
      startDate: currentPeriod.start,
      endDate: currentPeriod.end,
      schemaVersion: self.productAdvertisingSheetSnapshotSchemaVersion,
    }),
    input.exportRequestId
      ? self.wbClustersRepository.getProductPresetSnapshotJob({
          sourceExportRequestId: input.exportRequestId,
          startDate: currentPeriod.start,
          endDate: currentPeriod.end,
        })
      : Promise.resolve(null),
  ]);

  const preferredByNmId = new Map<number, PreferredProductAdvertisingSnapshotSummaryRecord>(
    preferredSnapshots.map((item) => [item.nmId, item]),
  );
  const items = uniqueNmIds.map((nmId) =>
    self.buildProductSnapshotReadinessItem({
      nmId,
      currentPeriod,
      exportRequestId: input.exportRequestId ?? null,
      preferredSnapshot: preferredByNmId.get(nmId) ?? null,
      presetJob,
    }),
  );

  return {
    checkedAt: new Date().toISOString(),
    exportRequestId: input.exportRequestId ?? null,
    range: {
      startDate: currentPeriod.start,
      endDate: currentPeriod.end,
    },
    items,
  };
}

export function buildProductSnapshotReadinessItem(
  self: WbClustersService,
  input: {
    nmId: number;
    currentPeriod: { start: string; end: string };
    exportRequestId: string | null;
    preferredSnapshot: PreferredProductAdvertisingSnapshotSummaryRecord | null;
    presetJob: ProductPresetSnapshotJobRecordSummary | null;
  },
): ProductSnapshotReadinessItem {
  const warmupState: ProductSnapshotWarmupState | null = self.getProductSnapshotWarmupState({
    nmId: input.nmId,
    period: input.currentPeriod,
    exportRequestId: input.exportRequestId,
  });
  const queuedByPresetJob =
    input.presetJob !== null && input.presetJob.nmIds.includes(input.nmId)
      ? input.presetJob
      : null;
  const preferredSnapshot =
    input.preferredSnapshot && input.preferredSnapshot.nmId === input.nmId
      ? input.preferredSnapshot
      : null;

  if (preferredSnapshot) {
    return self.buildSnapshotReadyItem(
      input.nmId,
      preferredSnapshot.fit === "exact" ? "ready" : "stale_ready",
      preferredSnapshot,
      preferredSnapshot.fit,
      preferredSnapshot.source,
      warmupState,
    );
  }

  if (warmupState?.status === "running" || queuedByPresetJob?.status === "running") {
    return {
      nmId: input.nmId,
      status: "running",
      priority: warmupState?.priority ?? null,
      snapshotFit: null,
      snapshotSource: null,
      builtAt: null,
      failureReason: null,
      requestedStartDate: input.currentPeriod.start,
      requestedEndDate: input.currentPeriod.end,
      snapshotStartDate: null,
      snapshotEndDate: null,
      updatedAt: warmupState?.updatedAt ?? queuedByPresetJob?.updatedAt ?? null,
    };
  }

  if (
    warmupState?.status === "queued" ||
    queuedByPresetJob?.status === "queued" ||
    queuedByPresetJob?.status === "retry_scheduled"
  ) {
    return {
      nmId: input.nmId,
      status: "queued",
      priority: warmupState?.priority ?? "background",
      snapshotFit: null,
      snapshotSource: null,
      builtAt: null,
      failureReason: null,
      requestedStartDate: input.currentPeriod.start,
      requestedEndDate: input.currentPeriod.end,
      snapshotStartDate: null,
      snapshotEndDate: null,
      updatedAt: warmupState?.updatedAt ?? queuedByPresetJob?.updatedAt ?? null,
    };
  }

  if (warmupState?.status === "failed" || queuedByPresetJob?.status === "failed") {
    return {
      nmId: input.nmId,
      status: "failed",
      priority: warmupState?.priority ?? null,
      snapshotFit: null,
      snapshotSource: null,
      builtAt: null,
      failureReason: warmupState?.failureReason ?? queuedByPresetJob?.lastError ?? null,
      requestedStartDate: input.currentPeriod.start,
      requestedEndDate: input.currentPeriod.end,
      snapshotStartDate: null,
      snapshotEndDate: null,
      updatedAt: warmupState?.updatedAt ?? queuedByPresetJob?.updatedAt ?? null,
    };
  }

  return {
    nmId: input.nmId,
    status: "missing",
    priority: warmupState?.priority ?? null,
    snapshotFit: null,
    snapshotSource: null,
    builtAt: null,
    failureReason: null,
    requestedStartDate: input.currentPeriod.start,
    requestedEndDate: input.currentPeriod.end,
    snapshotStartDate: null,
    snapshotEndDate: null,
    updatedAt: warmupState?.updatedAt ?? null,
  };
}

export function buildSnapshotReadyItem(
  self: WbClustersService,
  nmId: number,
  status: ProductSnapshotReadinessStatus,
  snapshot: ProductAdvertisingSnapshotSummaryRecord,
  snapshotFit: PreferredProductAdvertisingSnapshotSummaryRecord["fit"],
  snapshotSource: PreferredProductAdvertisingSnapshotSummaryRecord["source"],
  warmupState: ProductSnapshotWarmupState | null,
): ProductSnapshotReadinessItem {
  return {
    nmId,
    status,
    priority: warmupState?.priority ?? null,
    snapshotFit,
    snapshotSource,
    builtAt: snapshot.readyAt ?? snapshot.syncedAt,
    failureReason: snapshot.failureReason,
    requestedStartDate: null,
    requestedEndDate: null,
    snapshotStartDate: snapshot.startDate,
    snapshotEndDate: snapshot.endDate,
    updatedAt: warmupState?.updatedAt ?? snapshot.readyAt ?? snapshot.syncedAt,
  };
}

