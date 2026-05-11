import type { PromotionCampaignCountResponse } from "./wb-clusters.types";

export interface SyncPhaseTelemetry {
  runs: number;
  campaignsProcessed: number;
  elapsedMs: number;
  lastElapsedMs: number | null;
  lastFinishedAt: string | null;
}

export interface ClusterCampaignRef {
  advertId: number;
  changeTime: string | null;
  campaignType: number;
  campaignStatus: number;
}

export function createRawArchiveBuffer(input: {
  syncRunId: string;
  saveRawArchives: (
    batch: Array<{
      syncRunId: string;
      archiveType: string;
      advertId: number | null;
      nmId: number | null;
      payload: unknown;
    }>,
  ) => Promise<void>;
}) {
  const pendingEntries: Array<{
    archiveType: string;
    advertId: number | null;
    nmId: number | null;
    payload: unknown;
  }> = [];

  const flush = async () => {
    if (pendingEntries.length === 0) {
      return;
    }

    const batch = pendingEntries.splice(0, pendingEntries.length).map((entry) => ({
      syncRunId: input.syncRunId,
      archiveType: entry.archiveType,
      advertId: entry.advertId,
      nmId: entry.nmId,
      payload: entry.payload,
    }));
    await input.saveRawArchives(batch);
  };

  return {
    push: (entry: {
      archiveType: string;
      advertId: number | null;
      nmId: number | null;
      payload: unknown;
    }) => {
      pendingEntries.push(entry);
    },
    flush,
  };
}

export function createEmptySyncPhaseTelemetry(): SyncPhaseTelemetry {
  return {
    runs: 0,
    campaignsProcessed: 0,
    elapsedMs: 0,
    lastElapsedMs: null,
    lastFinishedAt: null,
  };
}

export function recordSyncPhaseTelemetry(
  telemetry: SyncPhaseTelemetry,
  campaignsProcessed: number,
  elapsedMs: number,
) {
  telemetry.runs += 1;
  telemetry.campaignsProcessed += Math.max(0, campaignsProcessed);
  telemetry.elapsedMs += Math.max(0, elapsedMs);
  telemetry.lastElapsedMs = Math.max(0, elapsedMs);
  telemetry.lastFinishedAt = new Date().toISOString();
}

export function buildSyncPhaseTelemetrySnapshot(telemetry: SyncPhaseTelemetry) {
  const avgCampaignsPerMinute =
    telemetry.elapsedMs > 0 ? (telemetry.campaignsProcessed / telemetry.elapsedMs) * 60_000 : null;
  return {
    runs: telemetry.runs,
    campaignsProcessed: telemetry.campaignsProcessed,
    avgCampaignsPerMinute,
    lastElapsedMs: telemetry.lastElapsedMs,
    lastFinishedAt: telemetry.lastFinishedAt,
  };
}

export function estimatePhaseSweepMinutes(
  telemetry: SyncPhaseTelemetry,
  campaignsStored: number,
) {
  if (campaignsStored <= 0) {
    return 0;
  }

  if (telemetry.campaignsProcessed <= 0 || telemetry.elapsedMs <= 0) {
    return null;
  }

  const campaignsPerMinute = (telemetry.campaignsProcessed / telemetry.elapsedMs) * 60_000;
  if (campaignsPerMinute <= 0) {
    return null;
  }

  return campaignsStored / campaignsPerMinute;
}

export function buildCampaignQueue(
  campaignRefs: ClusterCampaignRef[],
  lastCompletedAdvertId: number | null,
) {
  const uniqueSortedCampaigns = Array.from(
    new Map(
      campaignRefs
        .slice()
        .sort((left, right) => left.advertId - right.advertId)
        .map((item) => [item.advertId, item]),
    ).values(),
  );

  if (uniqueSortedCampaigns.length === 0 || lastCompletedAdvertId === null) {
    return uniqueSortedCampaigns;
  }

  const pivotIndex = uniqueSortedCampaigns.findIndex(
    (item) => item.advertId > lastCompletedAdvertId,
  );
  if (pivotIndex === -1) {
    return uniqueSortedCampaigns;
  }

  return [
    ...uniqueSortedCampaigns.slice(pivotIndex),
    ...uniqueSortedCampaigns.slice(0, pivotIndex),
  ];
}

export function extractCampaignRefsFromCountResponse(
  campaignCountResponse: PromotionCampaignCountResponse,
): ClusterCampaignRef[] {
  return Array.from(
    new Map(
      (campaignCountResponse.adverts ?? [])
        .flatMap((group: PromotionCampaignCountResponse["adverts"][number]) =>
          (group.advert_list ?? []).map((item) => ({
            advertId: item.advertId,
            changeTime: item.changeTime,
            campaignType: group.type,
            campaignStatus: group.status,
          })),
        )
        .map((item) => [item.advertId, item]),
    ).values(),
  );
}
