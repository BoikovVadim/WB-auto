import type {
  ProductAdvertisingSheetResponse,
  ProductAdvertisingWorkspaceCampaignTab,
  ProductAdvertisingWorkspaceCampaignTotals,
} from "./wb-clusters.types";
import { pickLatestIsoDate } from "./product-workspace.builder.dates";
import {
  addWorkspaceNullableNumbers,
  getWorkspaceCostPerThousand,
  getWorkspaceMoneyPerAction,
  getWorkspaceOrderedItems,
  getWorkspaceRatio,
} from "./product-workspace.builder.math";
import {
  isWorkspaceClusterActive,
  isWorkspaceClusterExcluded,
} from "./product-workspace.builder.sources";

type WorkspaceClusterRow = ProductAdvertisingSheetResponse["clusters"][number];

export function buildWorkspaceCampaignTabs(
  campaigns: ProductAdvertisingSheetResponse["campaigns"],
  rows: WorkspaceClusterRow[],
): ProductAdvertisingWorkspaceCampaignTab[] {
  const tabs = new Map<number, ProductAdvertisingWorkspaceCampaignTab>();

  for (const campaign of campaigns) {
    tabs.set(campaign.advertId, {
      advertId: campaign.advertId,
      campaignName: campaign.name,
      campaignType: campaign.campaignType,
      campaignStatus: campaign.campaignStatus,
      paymentType: campaign.paymentType,
      bidType: campaign.bidType,
      placementsSearch: campaign.placementsSearch ?? null,
      placementsRecommendations: campaign.placementsRecommendations ?? null,
      currency: campaign.currency,
      syncedAt: campaign.syncedAt,
      rowsCount: 0,
      totals: createEmptyWorkspaceCampaignTotals(),
    });
  }

  for (const row of rows) {
    if (row.advertId === null) {
      continue;
    }

    let currentTab = tabs.get(row.advertId);
    if (!currentTab) {
      currentTab = {
        advertId: row.advertId,
        campaignName: row.campaignName,
        campaignType: row.campaignType ?? null,
        campaignStatus: row.campaignStatus,
        paymentType: row.paymentType,
        bidType: row.bidType,
        placementsSearch: null,
        placementsRecommendations: null,
        currency: row.currency,
        syncedAt: row.updatedAt,
        rowsCount: 0,
        totals: createEmptyWorkspaceCampaignTotals(),
      };
      tabs.set(row.advertId, currentTab);
    }

    currentTab.rowsCount += 1;
    currentTab.campaignName = currentTab.campaignName ?? row.campaignName;
    currentTab.campaignType = currentTab.campaignType ?? row.campaignType ?? null;
    currentTab.campaignStatus = currentTab.campaignStatus ?? row.campaignStatus;
    currentTab.paymentType = currentTab.paymentType ?? row.paymentType;
    currentTab.bidType = currentTab.bidType ?? row.bidType;
    currentTab.currency = currentTab.currency ?? row.currency;
    currentTab.syncedAt = pickLatestIsoDate(currentTab.syncedAt, row.updatedAt);

    currentTab.totals.spend = addWorkspaceNullableNumbers(currentTab.totals.spend, row.spend);
    currentTab.totals.orders = addWorkspaceNullableNumbers(
      currentTab.totals.orders,
      getWorkspaceOrderedItems(row),
    );
    currentTab.totals.clicks = addWorkspaceNullableNumbers(currentTab.totals.clicks, row.clicks);
    currentTab.totals.views = addWorkspaceNullableNumbers(currentTab.totals.views, row.views);
    currentTab.totals.addToCart = addWorkspaceNullableNumbers(
      currentTab.totals.addToCart,
      row.addToCart,
    );

    if (isWorkspaceClusterExcluded(row)) {
      currentTab.totals.excludedCount += 1;
    } else if (isWorkspaceClusterActive(row)) {
      currentTab.totals.activeCount += 1;
    }
  }

  return Array.from(tabs.values())
    .map((item) => ({
      ...item,
      totals: {
        ...item.totals,
        ctr: getWorkspaceRatio(item.totals.clicks, item.totals.views),
        ctc: getWorkspaceRatio(item.totals.addToCart, item.totals.clicks),
        cto: getWorkspaceRatio(item.totals.orders, item.totals.addToCart),
        cpc: getWorkspaceMoneyPerAction(item.totals.spend, item.totals.clicks),
        cpm: getWorkspaceCostPerThousand(item.totals.spend, item.totals.views),
        cpo: getWorkspaceMoneyPerAction(item.totals.spend, item.totals.orders),
        viewToOrder: getWorkspaceRatio(item.totals.orders, item.totals.views),
      },
    }))
    .sort((left, right) => {
      const leftSpend = left.totals.spend ?? 0;
      const rightSpend = right.totals.spend ?? 0;
      if (rightSpend !== leftSpend) {
        return rightSpend - leftSpend;
      }

      return getWorkspaceCampaignLabel(left).localeCompare(getWorkspaceCampaignLabel(right), "ru");
    });
}

function createEmptyWorkspaceCampaignTotals(): ProductAdvertisingWorkspaceCampaignTotals {
  return {
    spend: 0,
    orders: 0,
    clicks: 0,
    views: 0,
    addToCart: 0,
    ctr: null,
    ctc: null,
    cto: null,
    cpc: null,
    cpm: null,
    cpo: null,
    viewToOrder: null,
    activeCount: 0,
    excludedCount: 0,
  };
}

function getWorkspaceCampaignLabel(group: { advertId: number; campaignName: string | null }) {
  if (group.campaignName) {
    return `${group.campaignName} (#${String(group.advertId)})`;
  }

  return `Кампания #${String(group.advertId)}`;
}
