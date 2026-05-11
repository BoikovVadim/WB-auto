import { ServiceUnavailableException } from "@nestjs/common";

import { extractCampaignRefsFromCountResponse } from "./wb-clusters-sync.helpers";
import type { ClusterCampaignRef } from "./wb-clusters-sync.helpers";
import type {
  PromotionCampaignCountResponse,
  PromotionCampaignDetailsItem,
  PromotionCampaignDetailsResponse,
} from "./wb-clusters.types";
import type { WbClustersRepository } from "./wb-clusters.repository";

type WbClustersService = any;
type StoredCampaignInventoryEntry =
  Awaited<ReturnType<WbClustersRepository["getStoredCampaignInventory"]>>[number];
type CampaignProduct = {
  nmId: number;
  subjectId: number | null;
  subjectName: string | null;
  searchBid: number | null;
  minSearchBid?: number | null;
};
type ResolvedProductCampaign = {
  campaignRef: ClusterCampaignRef;
  paymentType: string | null;
  products: CampaignProduct[];
};

export async function resolveCampaignInventoryForProduct(
  self: WbClustersService,
  input: {
    nmId: number;
    syncRunId: string;
    warningMessages: string[];
    preferStoredInventory?: boolean;
  },
) {
  const storedInventory: StoredCampaignInventoryEntry[] =
    await self.wbClustersRepository.getStoredCampaignInventory();
  const storedInventoryByAdvertId = new Map(
    storedInventory.map((item) => [item.advertId, item]),
  );
  const cachedCampaignCountResponse: PromotionCampaignCountResponse | null =
    await self.wbClustersRepository.getLatestCampaignCountsArchive();

  const cachedProductCampaigns: ResolvedProductCampaign[] = storedInventory
    .filter((item) => item.products.some((product) => product.nmId === input.nmId))
    .map((item) => ({
      campaignRef: {
        advertId: item.advertId,
        changeTime: item.changeTime,
        campaignType: item.campaignType,
        campaignStatus: item.campaignStatus,
      },
      paymentType: item.paymentType,
      products: item.products.filter((product: any) => product.nmId === input.nmId),
    }));

  if (input.preferStoredInventory && cachedProductCampaigns.length > 0) {
    self.pushWarning(
      input.warningMessages,
      `Using stored campaign inventory for fast manual refresh of product ${input.nmId}.`,
    );
    return cachedProductCampaigns;
  }

  const campaignCountResponse = await self.getCampaignCountsWithQuickRetry(
    `campaign counts for product ${input.nmId}`,
    input.warningMessages,
  );

  if (!campaignCountResponse) {
    if (cachedProductCampaigns.length > 0) {
      self.pushWarning(
        input.warningMessages,
        `Using cached campaign inventory for product ${input.nmId} because WB campaign list is temporarily rate-limited.`,
      );
    }

    if (cachedCampaignCountResponse) {
      self.pushWarning(
        input.warningMessages,
        `Using latest cached WB campaign-counts archive for product ${input.nmId} because live campaign list is temporarily rate-limited.`,
      );
    }
  }

  if (campaignCountResponse) {
    await self.wbClustersRepository.saveRawArchive({
      syncRunId: input.syncRunId,
      archiveType: "campaign-counts",
      advertId: null,
      nmId: input.nmId,
      payload: campaignCountResponse,
    });
  }

  const campaignRefs = (
    campaignCountResponse
      ? extractCampaignRefsFromCountResponse(campaignCountResponse)
      : cachedProductCampaigns.length > 0
        ? cachedProductCampaigns.map((item) => item.campaignRef)
        : cachedCampaignCountResponse
          ? extractCampaignRefsFromCountResponse(cachedCampaignCountResponse)
          : storedInventory.map((item) => ({
              advertId: item.advertId,
              changeTime: item.changeTime,
              campaignType: item.campaignType,
              campaignStatus: item.campaignStatus,
            }))
  ).sort((left, right) => left.advertId - right.advertId);

  if (campaignRefs.length === 0) {
    throw new ServiceUnavailableException(
      `WB Promotion API не вернул список кампаний, а в кэше еще нет кампаний для товара ${input.nmId}.`,
    );
  }

  const relevantCampaigns: ResolvedProductCampaign[] = [];

  for (const chunk of self.chunkArray(
    campaignRefs,
    self.campaignDetailsChunkSize,
  ) as ClusterCampaignRef[][]) {
    const detailResponse: PromotionCampaignDetailsResponse | null =
      await self.getCampaignDetailsWithQuickRetry(
        chunk.map((item) => item.advertId),
      `campaign details chunk (${chunk[0]?.advertId ?? 0}...${chunk[chunk.length - 1]?.advertId ?? 0}) for product ${input.nmId}`,
      input.warningMessages,
      );

    if (detailResponse) {
      await self.wbClustersRepository.saveRawArchive({
        syncRunId: input.syncRunId,
        archiveType: "campaign-details",
        advertId: null,
        nmId: input.nmId,
        payload: detailResponse,
      });
    }

    const detailByAdvertId = new Map<number, PromotionCampaignDetailsItem>(
      (detailResponse?.adverts ?? []).map((advert) => [advert.id, advert]),
    );

    for (const campaignRef of chunk) {
      const detail = detailByAdvertId.get(campaignRef.advertId) ?? null;
      const storedCampaign = storedInventoryByAdvertId.get(campaignRef.advertId) ?? null;
      const detailProducts: CampaignProduct[] = detail ? self.extractProductsFromDetail(detail) : [];
      const products = detailProducts.length > 0 ? detailProducts : storedCampaign?.products ?? [];

      if (products.length === 0) {
        continue;
      }

      const paymentType = self.readOptionalString(
        detail?.settings?.payment_type ?? storedCampaign?.paymentType,
      );

      await self.wbClustersRepository.upsertCampaign({
        advertId: campaignRef.advertId,
        campaignType: campaignRef.campaignType,
        campaignStatus: campaignRef.campaignStatus,
        paymentType,
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

      const productSlice = products.filter((product) => product.nmId === input.nmId);
      if (productSlice.length === 0) {
        continue;
      }

      relevantCampaigns.push({
        campaignRef,
        paymentType,
        products: productSlice,
      });
    }
  }

  if (relevantCampaigns.length === 0 && cachedProductCampaigns.length > 0) {
    self.pushWarning(
      input.warningMessages,
      `Using cached product campaigns for ${input.nmId} because fresh campaign details did not include this nmId.`,
    );
    return cachedProductCampaigns;
  }

  return relevantCampaigns;
}
