import { appEnv } from "../common/env";
import {
  buildCampaignQueue,
  type ClusterCampaignRef,
  createRawArchiveBuffer,
} from "./wb-clusters-sync.helpers";
import type {
  PromotionNormQueryListResponse,
  PromotionNormQueryMinusResponse,
} from "./wb-clusters.types";
import type { WbClustersRepository } from "./wb-clusters.repository";

type WbClustersService = any;
type StoredCampaignInventoryEntry =
  Awaited<ReturnType<WbClustersRepository["getStoredCampaignInventory"]>>[number];
type CampaignProduct = StoredCampaignInventoryEntry["products"][number];
type ClusterItem = {
  advertId: number;
  nmId: number;
};
type ClusterItemV0 = {
  advert_id: number;
  nm_id: number;
};
type OrderedCampaignContext = {
  campaignRef: ClusterCampaignRef;
  products: CampaignProduct[];
  clusterItems: ClusterItem[];
  clusterItemsV0: ClusterItemV0[];
};

export async function runStructureSyncPhase(self: WbClustersService, syncRunId: string) {
  const warningMessages: string[] = [];
  let campaignsSeen = 0;
  let campaignsSynced = 0;
  let productsSeen = 0;
  let clustersUpserted = 0;
  const nmIdsSeen = new Set<number>();
  const archiveBuffer = createRawArchiveBuffer({
    syncRunId,
    saveRawArchives: (batch) => self.wbClustersRepository.saveRawArchives(batch),
  });
  const storedInventory: StoredCampaignInventoryEntry[] =
    await self.wbClustersRepository.getStoredCampaignInventory();
  const cursorState = await self.wbClustersRepository.getSyncCursorState("structure");
  const campaignRefs: ClusterCampaignRef[] = storedInventory.map((item) => ({
    advertId: item.advertId,
    changeTime: item.changeTime,
    campaignType: item.campaignType,
    campaignStatus: item.campaignStatus,
  }));
  campaignsSeen = campaignRefs.length;
  const orderedCampaigns = buildCampaignQueue(campaignRefs, cursorState.lastCompletedAdvertId);

  const storedInventoryByAdvertId = new Map<number, StoredCampaignInventoryEntry>(
    storedInventory.map((item) => [item.advertId, item]),
  );
  const orderedCampaignContexts: OrderedCampaignContext[] = orderedCampaigns.flatMap((campaignRef) => {
    const campaign = storedInventoryByAdvertId.get(campaignRef.advertId) ?? null;
    const products: CampaignProduct[] = campaign?.products ?? [];
    if (products.length === 0) {
      return [];
    }

    for (const product of products) {
      nmIdsSeen.add(product.nmId);
    }

    const clusterItems: ClusterItem[] = products.map((product) => ({
      advertId: campaignRef.advertId,
      nmId: product.nmId,
    }));

    return [
      {
        campaignRef,
        products,
        clusterItems,
        clusterItemsV0: clusterItems.map((item) => ({
          advert_id: item.advertId,
          nm_id: item.nmId,
        })),
      },
    ];
  });
  const globalClusterItems = orderedCampaignContexts.flatMap((item) => item.clusterItems);
  const globalClusterItemsV0 = orderedCampaignContexts.flatMap((item) => item.clusterItemsV0);
  let phaseCompleted = true;

  for (const chunk of self.chunkArray(
    globalClusterItems,
    self.normQueryReadChunkSize,
  ) as ClusterItem[][]) {
    const listResponse: PromotionNormQueryListResponse | null = await self.tryApiStep(
      `normquery list chunk (${chunk[0]?.advertId ?? 0}...${chunk[chunk.length - 1]?.advertId ?? 0})`,
      () => self.wbPromotionApiClient.getNormQueryList(chunk),
      warningMessages,
    );
    if (!listResponse) {
      phaseCompleted = false;
      break;
    }

    archiveBuffer.push({
      archiveType: "normquery-list",
      advertId: null,
      nmId: null,
      payload: listResponse,
    });

    const clusterRows = (listResponse.items ?? []).flatMap((item) => [
      ...(item.normQueries?.active ?? []).map((clusterName) => ({
        advertId: item.advertId,
        nmId: item.nmId,
        clusterName,
        sourceKind: "active",
        isActive: true,
      })),
      ...(item.normQueries?.excluded ?? []).map((clusterName) => ({
        advertId: item.advertId,
        nmId: item.nmId,
        clusterName,
        sourceKind: "excluded",
        isActive: false,
      })),
    ]);
    clustersUpserted += await self.wbClustersRepository.upsertClusters(clusterRows);

    // Mark previously-active clusters that WB no longer returns as source_kind='stats'.
    // Prevents wb_clusters from accumulating stale entries that inflate the active count.
    const deactivationItems = (listResponse.items ?? []).map((item) => ({
      advertId: item.advertId,
      nmId: item.nmId,
      activeClusterNames: item.normQueries?.active ?? [],
    }));
    if (deactivationItems.length > 0) {
      await self.wbClustersRepository.deactivateStaleActiveClusters(deactivationItems);
    }
  }

  if (phaseCompleted) {
    for (const chunk of self.chunkArray(
      globalClusterItemsV0,
      self.normQueryReadChunkSize,
    ) as ClusterItemV0[][]) {
      const bidsResponse = await self.tryApiStep(
        `normquery bids chunk (${chunk[0]?.advert_id ?? 0}...${chunk[chunk.length - 1]?.advert_id ?? 0})`,
        () => self.wbPromotionApiClient.getNormQueryBids(chunk),
        warningMessages,
      );
      if (!bidsResponse) {
        phaseCompleted = false;
        break;
      }

      archiveBuffer.push({
        archiveType: "normquery-bids",
        advertId: null,
        nmId: null,
        payload: bidsResponse,
      });
      const nextBids = self.normalizeNormQueryBidsFromWb(bidsResponse.bids ?? []);
      if (nextBids.length > 0) {
        await self.wbClustersRepository.replaceClusterBids(
          chunk.map((item) => ({
            advertId: item.advert_id,
            nmId: item.nm_id,
          })),
          nextBids,
          { preservePending: true },
        );
      }

      const minusResponse: PromotionNormQueryMinusResponse | null = await self.tryApiStep(
        `normquery minus chunk (${chunk[0]?.advert_id ?? 0}...${chunk[chunk.length - 1]?.advert_id ?? 0})`,
        () => self.wbPromotionApiClient.getNormQueryMinus(chunk),
        warningMessages,
      );
      if (!minusResponse) {
        phaseCompleted = false;
        break;
      }

      archiveBuffer.push({
        archiveType: "normquery-minus",
        advertId: null,
        nmId: null,
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

  const cabinetSessionReady = await self.isCabinetSessionReady();

  if (phaseCompleted && appEnv.wbCabinetEnableInFullSync && cabinetSessionReady) {
    for (const campaignContext of orderedCampaignContexts) {
      for (const product of campaignContext.products) {
        let queryMapRowsUpserted = await self.syncCabinetClusterQueries({
          syncRunId,
          advertId: campaignContext.campaignRef.advertId,
          nmId: product.nmId,
          warningMessages,
          archiveBuffer,
        });
        if (queryMapRowsUpserted === 0 && self.wbCmpSafariClient.isAvailable()) {
          queryMapRowsUpserted += await self.syncCmpClusterQueries({
            syncRunId,
            advertId: campaignContext.campaignRef.advertId,
            nmId: product.nmId,
            warningMessages,
            archiveBuffer,
          });
        }
        clustersUpserted += queryMapRowsUpserted;
      }
    }
  } else if (
    phaseCompleted &&
    appEnv.wbPromotionEnableCmpInFullSync &&
    self.wbCmpSafariClient.isAvailable()
  ) {
    for (const campaignContext of orderedCampaignContexts) {
      for (const product of campaignContext.products) {
        clustersUpserted += await self.syncCmpClusterQueries({
          syncRunId,
          advertId: campaignContext.campaignRef.advertId,
          nmId: product.nmId,
          warningMessages,
          archiveBuffer,
        });
      }
    }
  }

  if (phaseCompleted) {
    campaignsSynced = orderedCampaigns.length;
    productsSeen = orderedCampaignContexts.reduce((total, item) => total + item.products.length, 0);
    const lastCampaign = orderedCampaigns[orderedCampaigns.length - 1] ?? null;
    if (lastCampaign) {
      await self.updatePhaseCursorState("structure", lastCampaign.advertId, syncRunId, true);
    }
  }

  await archiveBuffer.flush();
  return {
    campaignsSeen,
    campaignsSynced,
    productsSeen,
    clustersUpserted,
    statsRowsUpserted: 0,
    warningMessages,
    nmIdsSeen: Array.from(nmIdsSeen),
  };
}
