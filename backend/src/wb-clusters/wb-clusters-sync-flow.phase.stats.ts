import {
  buildCampaignQueue,
  type ClusterCampaignRef,
  createRawArchiveBuffer,
} from "./wb-clusters-sync.helpers";
import type {
  PromotionDailyNormQueryStatsResponse,
  PromotionNormQueryStatsResponse,
} from "./wb-clusters.types";
import type { WbClustersRepository } from "./wb-clusters.repository";
import type { WbClustersStatsSyncContext } from "./wb-clusters.flow-context";
type StoredCampaignInventoryEntry =
  Awaited<ReturnType<WbClustersRepository["getStoredCampaignInventory"]>>[number];
type DailyItem = {
  advertId: number;
  nmId: number;
};
type AggregateItem = {
  advert_id: number;
  nm_id: number;
};
type OrderedCampaignContext = {
  campaignRef: ClusterCampaignRef;
  campaign: StoredCampaignInventoryEntry;
  dailyItems: DailyItem[];
  aggregateItems: AggregateItem[];
};
type DailyClusterStatRow = {
  date: string;
  clusterName: string;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  addToCart: number | null;
  shks: number | null;
  ctr: number | null;
  avgPosition: number | null;
  cpc: number | null;
  cpm: number | null;
  spend: number | null;
  currency: string | null;
};

export async function runStatsSyncPhase(
  self: WbClustersStatsSyncContext,
  syncRunId: string,
  options?: { overridePeriod?: { from: string; to: string } },
) {
  const warningMessages: string[] = [];
  let campaignsSeen = 0;
  let campaignsSynced = 0;
  let productsSeen = 0;
  let statsRowsUpserted = 0;
  const nmIdsSeen = new Set<number>();
  const archiveBuffer = createRawArchiveBuffer({
    syncRunId,
    saveRawArchives: (batch) => self.wbClustersRepository.saveRawArchives(batch),
  });
  const statsPeriod = options?.overridePeriod ?? self.getStatsPeriod();
  const storedInventory: StoredCampaignInventoryEntry[] = (
    await self.wbClustersRepository.getStoredCampaignInventory()
  ).filter((item: StoredCampaignInventoryEntry) => item.products.length > 0);
  const eligibleCampaigns = storedInventory.filter(
    (item) => item.paymentType === "cpm" || item.paymentType === "cpc",
  );
  campaignsSeen = eligibleCampaigns.length;
  const cursorState = await self.wbClustersRepository.getSyncCursorState("stats");
  const orderedCampaigns = buildCampaignQueue(
    eligibleCampaigns.map((item) => ({
      advertId: item.advertId,
      changeTime: item.changeTime,
      campaignType: item.campaignType,
      campaignStatus: item.campaignStatus,
    })),
    cursorState.lastCompletedAdvertId,
  );
  const campaignsByAdvertId = new Map<number, StoredCampaignInventoryEntry>(
    eligibleCampaigns.map((item) => [item.advertId, item]),
  );
  const orderedCampaignContexts: OrderedCampaignContext[] = orderedCampaigns.flatMap((campaignRef) => {
    const campaign: any = campaignsByAdvertId.get(campaignRef.advertId) ?? null;
    if (!campaign || campaign.products.length === 0) {
      return [];
    }

    for (const product of campaign.products as Array<{ nmId: number }>) {
      nmIdsSeen.add(product.nmId);
    }

    return [
      {
        campaignRef,
        campaign,
        dailyItems: campaign.products.map((product: { nmId: number }) => ({
          advertId: campaign.advertId,
          nmId: product.nmId,
        })),
        aggregateItems:
          campaign.paymentType === "cpm"
            ? campaign.products.map((product: { nmId: number }) => ({
                advert_id: campaign.advertId,
                nm_id: product.nmId,
              }))
            : [],
      },
    ];
  });
  const globalDailyItems = orderedCampaignContexts.flatMap((item) => item.dailyItems);
  const globalAggregateItems = orderedCampaignContexts.flatMap((item) => item.aggregateItems);
  let phaseCompleted = true;

  for (const chunk of self.chunkArray(
    globalDailyItems,
    self.statsNormQueryChunkSize,
  ) as DailyItem[][]) {
    const dailyStatsResponse: PromotionDailyNormQueryStatsResponse | null =
      await self.tryApiStep(
      `daily cluster stats chunk (${chunk[0]?.advertId ?? 0}...${chunk[chunk.length - 1]?.advertId ?? 0})`,
      () =>
        self.wbPromotionApiClient.getDailyNormQueryStats({
          from: statsPeriod.from,
          to: statsPeriod.to,
          items: chunk,
        }),
      warningMessages,
      );
    if (!dailyStatsResponse) {
      phaseCompleted = false;
      break;
    }

    archiveBuffer.push({
      archiveType: "normquery-daily-stats",
      advertId: null,
      nmId: null,
      payload: dailyStatsResponse,
    });

    for (const item of dailyStatsResponse.items ?? []) {
      const rows: DailyClusterStatRow[] = (item.dailyStats ?? [])
        .map((dailyStat) => ({
          date: self.toIsoDate(new Date(dailyStat.date)),
          clusterName: self.readOptionalString(dailyStat.stat?.normQuery) ?? "",
          views: self.toNullableNumber(dailyStat.stat?.views),
          clicks: self.toNullableNumber(dailyStat.stat?.clicks),
          orders: self.toNullableNumber(dailyStat.stat?.orders),
          addToCart: self.toNullableNumber(dailyStat.stat?.atbs),
          shks: self.toNullableNumber(dailyStat.stat?.shks),
          ctr: self.toNullableNumber(dailyStat.stat?.ctr),
          avgPosition: self.toNullableNumber(dailyStat.stat?.avgPos),
          cpc: self.toNullableNumber(dailyStat.stat?.cpc),
          cpm: self.toNullableNumber(dailyStat.stat?.cpm),
          spend: self.toNullableNumber(dailyStat.stat?.spend),
          currency: self.readOptionalString(dailyStat.stat?.currency),
        }))
        .filter((row) => row.clusterName.length > 0);

      if (rows.length > 0) {
        statsRowsUpserted += await self.wbClustersRepository.upsertClusterDailyStats({
          advertId: item.advertId,
          nmId: item.nmId,
          rows,
        });
      }
    }
  }

  if (phaseCompleted) {
    for (const chunk of self.chunkArray(
      globalAggregateItems,
      self.statsNormQueryChunkSize,
    ) as AggregateItem[][]) {
      const statsResponse: PromotionNormQueryStatsResponse | null = await self.tryApiStep(
        `aggregate cluster stats chunk (${chunk[0]?.advert_id ?? 0}...${chunk[chunk.length - 1]?.advert_id ?? 0})`,
        () =>
          self.wbPromotionApiClient.getNormQueryStats({
            from: statsPeriod.from,
            to: statsPeriod.to,
            items: chunk,
          }),
        warningMessages,
      );
      if (!statsResponse) {
        phaseCompleted = false;
        break;
      }

      archiveBuffer.push({
        archiveType: "normquery-stats",
        advertId: null,
        nmId: null,
        payload: statsResponse,
      });
      const statRows = (statsResponse.stats ?? []).flatMap((productStats) =>
        (productStats.stats ?? []).map((statRow) => ({
          advertId: productStats.advert_id,
          nmId: productStats.nm_id,
          clusterName: statRow.norm_query,
          views: self.toNullableNumber(statRow.views),
          clicks: self.toNullableNumber(statRow.clicks),
          orders: self.toNullableNumber(statRow.orders),
          addToCart: self.toNullableNumber(statRow.atbs),
          shks: self.toNullableNumber(statRow.shks),
          ctr: self.toNullableNumber(statRow.ctr),
          avgPosition: self.toNullableNumber(statRow.avg_pos),
          cpc: self.toNullableNumber(statRow.cpc),
          cpm: self.toNullableNumber(statRow.cpm),
          spend: self.toNullableNumber(statRow.spend),
          currency: self.readOptionalString(statRow.currency),
        })),
      );
      statsRowsUpserted += await self.wbClustersRepository.upsertClusterStatsBulk(statRows);
    }
  }

  if (phaseCompleted) {
    campaignsSynced = orderedCampaignContexts.length;
    productsSeen = orderedCampaignContexts.reduce(
      (total, item) => total + item.campaign.products.length,
      0,
    );
    const lastCampaign = orderedCampaigns[orderedCampaigns.length - 1] ?? null;
    if (lastCampaign) {
      await self.updatePhaseCursorState("stats", lastCampaign.advertId, syncRunId, false);
    }
  }

  await archiveBuffer.flush();
  return {
    campaignsSeen,
    campaignsSynced,
    productsSeen,
    clustersUpserted: 0,
    statsRowsUpserted,
    warningMessages,
    nmIdsSeen: Array.from(nmIdsSeen),
  };
}
