
import type {
  PromotionDailyNormQueryStatsResponse,
  PromotionNormQueryListResponse,
  PromotionNormQueryMinusResponse,
  PromotionNormQueryStatsResponse,
} from "./wb-clusters.types";

type WbClustersService = any;
type RefreshProduct = {
  nmId: number;
  subjectId: number | null;
  subjectName: string | null;
};
type ClusterItem = {
  advertId: number;
  nmId: number;
};
type ClusterItemV0 = {
  advert_id: number;
  nm_id: number;
};
type DailyClusterStatRow = {
  date: string;
  clusterName: string | null;
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

export async function refreshCampaignProductSlice(
  self: WbClustersService,
  input: {
    syncRunId: string;
    nmId: number;
    statsPeriod: { from: string; to: string };
    cabinetSessionReady: boolean;
    cmpBridgeAvailable: boolean;
    advertId: number;
    paymentType: string | null;
    products: Array<{
      nmId: number;
      subjectId: number | null;
      subjectName: string | null;
    }>;
    warningMessages: string[];
  },
) {
  let clustersUpserted = 0;
  let statsRowsUpserted = 0;

  const clusterItems: ClusterItem[] = input.products.map((product: RefreshProduct) => ({
    advertId: input.advertId,
    nmId: product.nmId,
  }));
  const clusterItemsV0: ClusterItemV0[] = clusterItems.map((item) => ({
    advert_id: item.advertId,
    nm_id: item.nmId,
  }));

  for (const chunk of self.chunkArray(clusterItems, 100) as ClusterItem[][]) {
    const listResponse: PromotionNormQueryListResponse | null = await self.tryApiStep(
      `normquery list for advert ${input.advertId}, nm ${input.nmId}`,
      () => self.wbPromotionApiClient.getNormQueryList(chunk),
      input.warningMessages,
    );
    if (!listResponse) {
      continue;
    }

    await self.wbClustersRepository.saveRawArchive({
      syncRunId: input.syncRunId,
      archiveType: "normquery-list",
      advertId: input.advertId,
      nmId: input.nmId,
      payload: listResponse,
    });

    for (const item of (listResponse.items ?? []) as any[]) {
      for (const clusterName of item.normQueries?.active ?? []) {
        await self.wbClustersRepository.upsertCluster({
          advertId: item.advertId,
          nmId: item.nmId,
          clusterName,
          sourceKind: "active",
          isActive: true,
        });
        clustersUpserted += 1;
      }

      for (const clusterName of item.normQueries?.excluded ?? []) {
        await self.wbClustersRepository.upsertCluster({
          advertId: item.advertId,
          nmId: item.nmId,
          clusterName,
          sourceKind: "excluded",
          isActive: false,
        });
        clustersUpserted += 1;
      }
    }
  }

  for (const chunk of self.chunkArray(clusterItemsV0, 100) as ClusterItemV0[][]) {
    const bidsResponse = await self.tryApiStep(
      `normquery bids for advert ${input.advertId}, nm ${input.nmId}`,
      () => self.wbPromotionApiClient.getNormQueryBids(chunk),
      input.warningMessages,
    );
    if (bidsResponse) {
      await self.wbClustersRepository.saveRawArchive({
        syncRunId: input.syncRunId,
        archiveType: "normquery-bids",
        advertId: input.advertId,
        nmId: input.nmId,
        payload: bidsResponse,
      });
      const nextBids = self.normalizeNormQueryBidsFromWb(bidsResponse.bids ?? []);
      if (nextBids.length > 0) {
        await self.wbClustersRepository.replaceClusterBids(
          chunk.map((item: any) => ({
            advertId: item.advert_id,
            nmId: item.nm_id,
          })),
          nextBids,
          { preservePending: true },
        );
      }
    }

    const minusResponse: PromotionNormQueryMinusResponse | null = await self.tryApiStep(
      `normquery minus for advert ${input.advertId}, nm ${input.nmId}`,
      () => self.wbPromotionApiClient.getNormQueryMinus(chunk),
      input.warningMessages,
    );
    if (minusResponse) {
      await self.wbClustersRepository.saveRawArchive({
        syncRunId: input.syncRunId,
        archiveType: "normquery-minus",
        advertId: input.advertId,
        nmId: input.nmId,
        payload: minusResponse,
      });
      await self.wbClustersRepository.replaceCampaignMinusPhrases(
        chunk.map((item) => ({
          advertId: item.advert_id,
          nmId: item.nm_id,
        })),
        minusResponse.items ?? [],
      );
    }
  }

  if (input.paymentType === "cpm" || input.paymentType === "cpc") {
    for (const chunk of self.chunkArray(clusterItems, 100) as ClusterItem[][]) {
      const dailyStatsResponse: PromotionDailyNormQueryStatsResponse | null =
        await self.tryApiStep(
        `daily cluster stats for advert ${input.advertId}, nm ${input.nmId}`,
        () =>
          self.wbPromotionApiClient.getDailyNormQueryStats({
            from: input.statsPeriod.from,
            to: input.statsPeriod.to,
            items: chunk,
          }),
        input.warningMessages,
        );
      if (!dailyStatsResponse) {
        continue;
      }

      await self.wbClustersRepository.saveRawArchive({
        syncRunId: input.syncRunId,
        archiveType: "normquery-daily-stats",
        advertId: input.advertId,
        nmId: input.nmId,
        payload: dailyStatsResponse,
      });

      for (const item of dailyStatsResponse.items ?? []) {
        const rows: DailyClusterStatRow[] = (item.dailyStats ?? [])
          .map((dailyStat) => ({
            date: self.toIsoDate(new Date(dailyStat.date)),
            clusterName: self.readOptionalString(dailyStat.stat?.normQuery),
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
          .filter((row) => Boolean(row.clusterName));

        if (rows.length > 0) {
          statsRowsUpserted += await self.wbClustersRepository.replaceClusterDailyStats({
            advertId: item.advertId,
            nmId: item.nmId,
            from: input.statsPeriod.from,
            to: input.statsPeriod.to,
            rows,
          });
        }
      }
    }
  }

  if (input.paymentType === "cpm") {
    const statsItems: ClusterItemV0[] = input.products.map((product: RefreshProduct) => ({
      advert_id: input.advertId,
      nm_id: product.nmId,
    }));

    for (const chunk of self.chunkArray(statsItems, 100) as ClusterItemV0[][]) {
      const statsResponse: PromotionNormQueryStatsResponse | null = await self.tryApiStep(
        `aggregate cluster stats for advert ${input.advertId}, nm ${input.nmId}`,
        () =>
          self.wbPromotionApiClient.getNormQueryStats({
            from: input.statsPeriod.from,
            to: input.statsPeriod.to,
            items: chunk,
          }),
        input.warningMessages,
      );
      if (!statsResponse) {
        continue;
      }

      await self.wbClustersRepository.saveRawArchive({
        syncRunId: input.syncRunId,
        archiveType: "normquery-stats",
        advertId: input.advertId,
        nmId: input.nmId,
        payload: statsResponse,
      });

      for (const productStats of statsResponse.stats ?? []) {
        for (const statRow of productStats.stats ?? []) {
          await self.wbClustersRepository.upsertClusterStats({
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
          });
          statsRowsUpserted += 1;
        }
      }
    }
  }

  if (input.cabinetSessionReady) {
    for (const product of input.products) {
      let queryMapRowsUpserted = await self.syncCabinetClusterQueries({
        syncRunId: input.syncRunId,
        advertId: input.advertId,
        nmId: product.nmId,
        warningMessages: input.warningMessages,
      });
      if (queryMapRowsUpserted === 0 && input.cmpBridgeAvailable) {
        queryMapRowsUpserted += await self.syncCmpClusterQueries({
          syncRunId: input.syncRunId,
          advertId: input.advertId,
          nmId: product.nmId,
          warningMessages: input.warningMessages,
        });
      }
      clustersUpserted += queryMapRowsUpserted;
    }
  } else if (input.cmpBridgeAvailable) {
    for (const product of input.products) {
      clustersUpserted += await self.syncCmpClusterQueries({
        syncRunId: input.syncRunId,
        advertId: input.advertId,
        nmId: product.nmId,
        warningMessages: input.warningMessages,
      });
    }
  }

  return {
    clustersUpserted,
    statsRowsUpserted,
  };
}
