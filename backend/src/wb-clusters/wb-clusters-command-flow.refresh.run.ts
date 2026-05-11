
type WbClustersService = any;

export async function refreshProductAdvertisingInternal(
  self: WbClustersService,
  nmId: number,
  syncRunId: string,
): Promise<void> {
  const warningMessages: string[] = [];
  let campaignsSeen = 0;
  let campaignsSynced = 0;
  let productsSeen = 0;
  let clustersUpserted = 0;
  let statsRowsUpserted = 0;

  try {
    const activeBidActivity = await self.wbClustersRepository.getActiveClusterBidActivity({ nmId });
    const activeActionActivity = await self.wbClustersRepository.getActiveClusterActionActivity({
      nmId,
    });
    if (
      activeBidActivity.activeJobCount > 0 ||
      activeActionActivity.activeJobCount > 0 ||
      self.isPromotionLowNoiseModeActive()
    ) {
      self.pushWarning(
        warningMessages,
        `Deferred product advertising refresh for ${nmId} because cluster mutations or WB low-noise mode are still active.`,
      );
      setTimeout(() => {
        self.scheduleProductAdvertisingRefresh(nmId, "bid-activity-drain");
      }, Math.max(self.getPromotionLowNoiseRemainingMs(), 5_000));
      await self.wbClustersRepository.completeSyncRun(syncRunId, {
        status: "succeeded",
        campaignsSeen: 0,
        campaignsSynced: 0,
        productsSeen: 0,
        clustersUpserted: 0,
        statsRowsUpserted: 0,
        warningCount: warningMessages.length,
        hasPartialFailure: warningMessages.length > 0,
        errorMessage: self.summarizeWarnings(warningMessages),
      });
      return;
    }

    const statsPeriod = self.getStatsPeriod();
    const cabinetSessionReady = await self.isCabinetSessionReady();
    const cmpBridgeAvailable = self.wbCmpSafariClient.isAvailable();
    const relevantCampaigns = await self.resolveCampaignInventoryForProduct({
      nmId,
      syncRunId,
      warningMessages,
      preferStoredInventory: true,
    });

    campaignsSeen = relevantCampaigns.length;
    await self.wbClustersRepository.updateSyncRunProgress(syncRunId, {
      campaignsSeen,
      campaignsSynced,
      productsSeen,
      clustersUpserted,
      statsRowsUpserted,
      warningCount: warningMessages.length,
      hasPartialFailure: warningMessages.length > 0,
    });

    for (const item of relevantCampaigns) {
      const campaignSummary = await self.refreshCampaignProductSlice({
        syncRunId,
        nmId,
        statsPeriod,
        cabinetSessionReady,
        cmpBridgeAvailable,
        advertId: item.campaignRef.advertId,
        paymentType: item.paymentType,
        products: item.products,
        warningMessages,
      });

      clustersUpserted += campaignSummary.clustersUpserted;
      statsRowsUpserted += campaignSummary.statsRowsUpserted;
      productsSeen += item.products.length;
      campaignsSynced += 1;

      await self.wbClustersRepository.updateSyncRunProgress(syncRunId, {
        campaignsSeen,
        campaignsSynced,
        productsSeen,
        clustersUpserted,
        statsRowsUpserted,
        warningCount: warningMessages.length,
        hasPartialFailure: warningMessages.length > 0,
        errorMessage: self.summarizeWarnings(warningMessages),
      });
    }

    const warningMessage =
      relevantCampaigns.length === 0
        ? self.summarizeWarnings([
            ...warningMessages,
            `По товару ${nmId} не найдено активных рекламных кампаний.`,
          ])
        : self.summarizeWarnings(warningMessages);

    await self.materializeProductAdvertisingSheets([nmId], "manual-refresh");
    await self.wbClustersRepository.completeSyncRun(syncRunId, {
      status: "succeeded",
      campaignsSeen,
      campaignsSynced,
      productsSeen,
      clustersUpserted,
      statsRowsUpserted,
      warningCount: warningMessages.length,
      hasPartialFailure: warningMessages.length > 0,
      errorMessage: warningMessage,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown WB product advertising refresh error";
    await self.wbClustersRepository.completeSyncRun(syncRunId, {
      status: "failed",
      campaignsSeen,
      campaignsSynced,
      productsSeen,
      clustersUpserted,
      statsRowsUpserted,
      warningCount: warningMessages.length,
      hasPartialFailure: warningMessages.length > 0,
      errorMessage,
    });
    throw error;
  }
}
