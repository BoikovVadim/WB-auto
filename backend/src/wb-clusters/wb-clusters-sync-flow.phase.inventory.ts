import {
  buildCampaignQueue,
  type ClusterCampaignRef,
  createRawArchiveBuffer,
  extractCampaignRefsFromCountResponse,
} from "./wb-clusters-sync.helpers";
import type {
  PromotionCampaignCountResponse,
  PromotionCampaignDetailsItem,
  PromotionCampaignDetailsResponse,
} from "./wb-clusters.types";
import type { WbClustersRepository } from "./wb-clusters.repository";

type WbClustersService = any;
type StoredCampaignInventoryEntry =
  Awaited<ReturnType<WbClustersRepository["getStoredCampaignInventory"]>>[number];
type InventoryProduct = StoredCampaignInventoryEntry["products"][number];

export async function runInventorySyncPhase(self: WbClustersService, syncRunId: string) {
  const warningMessages: string[] = [];
  let campaignsSeen = 0;
  let campaignsSynced = 0;
  let productsSeen = 0;
  const nmIdsSeen = new Set<number>();
  const archiveBuffer = createRawArchiveBuffer({
    syncRunId,
    saveRawArchives: (batch) => self.wbClustersRepository.saveRawArchives(batch),
  });
  const storedInventory: StoredCampaignInventoryEntry[] =
    await self.wbClustersRepository.getStoredCampaignInventory();
  const storedInventoryByAdvertId = new Map<number, StoredCampaignInventoryEntry>(
    storedInventory.map((item) => [item.advertId, item]),
  );
  const cachedCampaignCountResponse: PromotionCampaignCountResponse | null =
    await self.wbClustersRepository.getLatestCampaignCountsArchive();
  let campaignRefs: ClusterCampaignRef[] = [];

  const campaignCountResponse = await self.tryApiStep(
    "campaign counts",
    () =>
      self.wbPromotionApiClient.getCampaignCounts({
        failFastOnTooManyRequests: true,
      }),
    warningMessages,
  );

  if (campaignCountResponse) {
    archiveBuffer.push({
      archiveType: "campaign-counts",
      advertId: null,
      nmId: null,
      payload: campaignCountResponse,
    });
    campaignRefs = extractCampaignRefsFromCountResponse(campaignCountResponse);
  } else if (cachedCampaignCountResponse) {
    self.pushWarning(
      warningMessages,
      "Using latest cached WB campaign-counts archive because live campaign list is temporarily rate-limited.",
    );
    campaignRefs = extractCampaignRefsFromCountResponse(cachedCampaignCountResponse);
  } else {
    campaignRefs = storedInventory.map((item) => ({
      advertId: item.advertId,
      changeTime: item.changeTime,
      campaignType: item.campaignType,
      campaignStatus: item.campaignStatus,
    }));
    if (campaignRefs.length > 0) {
      self.pushWarning(
        warningMessages,
        "Using cached campaign inventory from PostgreSQL because WB campaign list is temporarily rate-limited.",
      );
    }
  }

  campaignsSeen = campaignRefs.length;
  const cursorState = await self.wbClustersRepository.getSyncCursorState("inventory");
  const orderedCampaigns = buildCampaignQueue(campaignRefs, cursorState.lastCompletedAdvertId);

  const detailChunks = self.chunkArray(
    orderedCampaigns.map((item) => item.advertId),
    self.campaignDetailsChunkSize,
  ) as number[][];
  const details = new Map<number, PromotionCampaignDetailsItem>();
  for (const chunk of detailChunks) {
    const detailResponse: PromotionCampaignDetailsResponse | null = await self.tryApiStep(
      `campaign details chunk (${chunk[0]}...${chunk[chunk.length - 1]})`,
      () =>
        self.wbPromotionApiClient.getCampaignDetails(chunk, {
          failFastOnTooManyRequests: true,
        }),
      warningMessages,
    );
    if (!detailResponse) {
      break;
    }

    archiveBuffer.push({
      archiveType: "campaign-details",
      advertId: null,
      nmId: null,
      payload: detailResponse,
    });
    for (const advert of detailResponse.adverts ?? []) {
      details.set(advert.id, advert);
    }
  }

  for (const campaignRef of orderedCampaigns) {
    const detail = details.get(campaignRef.advertId) ?? null;
    const storedCampaign = storedInventoryByAdvertId.get(campaignRef.advertId) ?? null;
    const detailProducts: InventoryProduct[] = detail ? self.extractProductsFromDetail(detail) : [];
    const products = detailProducts.length > 0 ? detailProducts : storedCampaign?.products ?? [];

    if (products.length === 0) {
      self.pushWarning(
        warningMessages,
        `Campaign ${campaignRef.advertId} was skipped because WB details were unavailable and no cached products exist yet.`,
      );
      await self.updatePhaseCursorState("inventory", campaignRef.advertId, syncRunId, true);
      continue;
    }

    await self.wbClustersRepository.upsertCampaign({
      advertId: campaignRef.advertId,
      campaignType: campaignRef.campaignType,
      campaignStatus: campaignRef.campaignStatus,
      paymentType: self.readOptionalString(detail?.settings?.payment_type ?? storedCampaign?.paymentType),
      bidType: self.readOptionalString(detail?.bid_type ?? storedCampaign?.bidType),
      currency: self.readOptionalString(detail?.currency ?? storedCampaign?.currency),
      name: self.readOptionalString(detail?.settings?.name ?? storedCampaign?.name),
      changeTime: campaignRef.changeTime ?? storedCampaign?.changeTime ?? null,
      createdAtWb: self.readOptionalString(
        detail?.timestamps?.created ?? storedCampaign?.createdAtWb,
      ),
      startedAtWb: self.readOptionalString(
        detail?.timestamps?.started ?? storedCampaign?.startedAtWb,
      ),
      updatedAtWb: self.readOptionalString(
        detail?.timestamps?.updated ?? storedCampaign?.updatedAtWb,
      ),
    });

    if (detailProducts.length > 0) {
      await self.wbClustersRepository.replaceCampaignProducts(campaignRef.advertId, products);
    }

    for (const product of products) {
      nmIdsSeen.add(product.nmId);
    }
    campaignsSynced += 1;
    productsSeen += products.length;
    await self.updatePhaseCursorState("inventory", campaignRef.advertId, syncRunId, true);
  }

  await archiveBuffer.flush();
  return {
    campaignsSeen,
    campaignsSynced,
    productsSeen,
    clustersUpserted: 0,
    statsRowsUpserted: 0,
    warningMessages,
    nmIdsSeen: Array.from(nmIdsSeen),
  };
}
