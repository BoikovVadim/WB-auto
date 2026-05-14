import type {
  ProductAdvertisingDailyStat,
  ProductAdvertisingSheetResponse,
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingWorkspaceCampaignTab,
  ProductAdvertisingWorkspaceCampaignTotals,
  ProductAdvertisingWorkspaceResponse,
  ProductCatalogItem,
} from "../../../api/syncClient";
import {
  averageAdvertisingValues,
  getAdvertisingCostPerThousand,
  getAdvertisingCpoOrSpend,
  getAdvertisingMoneyPerAction,
  getAdvertisingOrderedItems,
  getAdvertisingRatio,
  isClusterActive,
  isClusterExcluded,
} from "./model";
import { getAdvertisingSourcePriority } from "./advertisingModelStatus";

type WorkspaceShellClusterRow = ProductAdvertisingSheetResponse["clusters"][number];

export type InstantWorkspaceHeaderProduct = Pick<
  ProductCatalogItem,
  "nmId" | "vendorCode" | "name" | "brandName" | "subjectName"
>;

export function buildInstantProductWorkspaceFromSheet(input: {
  sheet: ProductAdvertisingSheetResponse;
  productCatalogItem?: InstantWorkspaceHeaderProduct | null;
}): ProductAdvertisingWorkspaceResponse {
  const projectedClusters = buildInstantWorkspaceClusterRowsFromSheet(input.sheet);
  const campaignTabs = buildWorkspaceShellCampaignTabs(input.sheet.campaigns, projectedClusters);
  const defaultCampaignId = campaignTabs[0]?.advertId ?? null;
  const dailyStatsBounds = getWorkspaceShellDailyStatsBounds(input.sheet.dailyStats);

  return {
    nmId: input.sheet.nmId,
    checkedAt: input.sheet.checkedAt,
    readiness: {
      scope: "workspace",
      status: "ready",
      source: "sheet_snapshot",
      materializationStatus: "fallback_sheet",
    },
    header: {
      nmId: input.sheet.nmId,
      vendorCode: input.productCatalogItem?.vendorCode ?? null,
      productName: input.productCatalogItem?.name ?? null,
      brandName: input.productCatalogItem?.brandName ?? null,
      subjectName: input.productCatalogItem?.subjectName ?? null,
    },
    snapshot: input.sheet.snapshot,
    range: input.sheet.range,
    dateBounds: {
      minDate: input.sheet.summary.dailyStatsWindowStartDate ?? dailyStatsBounds.minDate,
      maxDate: input.sheet.summary.dailyStatsWindowEndDate ?? dailyStatsBounds.maxDate,
      defaultStartDate: input.sheet.range.startDate,
      defaultEndDate: input.sheet.range.endDate,
    },
    campaignTabs,
    defaultCampaignId,
    selectedCampaignSummary:
      campaignTabs.find((item) => item.advertId === defaultCampaignId) ?? null,
    initialClusterTable: null,
    syncState: {
      hasPendingClusterSync: input.sheet.clusters.some(
        (cluster) =>
          (cluster.bidSyncStatus !== null && cluster.bidSyncStatus !== "confirmed") ||
          (cluster.actionSyncStatus !== null && cluster.actionSyncStatus !== "confirmed"),
      ),
      refreshStatus: "idle",
      syncRunId: null,
      startedAt: null,
    },
    diagnostics: {
      periodMetricsStatus: input.sheet.summary.periodMetricsStatus,
      periodMetricsActualStartDate: input.sheet.summary.periodMetricsActualStartDate,
      periodMetricsActualEndDate: input.sheet.summary.periodMetricsActualEndDate,
      dailyStatsWindowStartDate: input.sheet.summary.dailyStatsWindowStartDate,
      dailyStatsWindowEndDate: input.sheet.summary.dailyStatsWindowEndDate,
      queryCoverageStatus: input.sheet.summary.queryCoverageStatus,
    },
  };
}

export function buildInstantWorkspaceClusterRowsFromSheet(
  sheet: ProductAdvertisingSheetResponse,
): ProductAdvertisingWorkspaceClusterRow[] {
  const mergedClusters = mergeWorkspaceShellClusters(sheet.clusters);
  return projectWorkspaceShellClustersForRange(mergedClusters, sheet)
    .filter((row) => isWorkspaceShellDisplayCluster(row))
    .map((row) => ({
      ...row,
      clusterKey: buildWorkspaceShellClusterKey(row.advertId, row.clusterName),
    }));
}

function mergeWorkspaceShellClusters(
  clusters: ProductAdvertisingSheetResponse["clusters"],
): WorkspaceShellClusterRow[] {
  const mergedClusters = new Map<string, WorkspaceShellClusterRow>();

  for (const cluster of clusters) {
    const key = `${cluster.advertId ?? "none"}:${normalizeWorkspaceShellText(cluster.clusterName)}`;
    const existing = mergedClusters.get(key);
    if (!existing) {
      mergedClusters.set(key, { ...cluster });
      continue;
    }

    existing.campaignName = existing.campaignName ?? cluster.campaignName;
    existing.campaignType = existing.campaignType ?? cluster.campaignType;
    existing.campaignStatus = existing.campaignStatus ?? cluster.campaignStatus;
    existing.paymentType = existing.paymentType ?? cluster.paymentType;
    existing.bidType = existing.bidType ?? cluster.bidType;
    existing.currency = existing.currency ?? cluster.currency;
    existing.canonicalNormQuery = existing.canonicalNormQuery || cluster.canonicalNormQuery;
    existing.views = pickPreferredNullableNumber(existing.views, cluster.views);
    existing.clicks = pickPreferredNullableNumber(existing.clicks, cluster.clicks);
    existing.orders = pickPreferredNullableNumber(existing.orders, cluster.orders);
    existing.addToCart = pickPreferredNullableNumber(existing.addToCart, cluster.addToCart);
    existing.shks = pickPreferredNullableNumber(existing.shks, cluster.shks);
    existing.ctr = pickPreferredNullableNumber(existing.ctr, cluster.ctr);
    existing.avgPosition = pickPreferredNullableNumber(existing.avgPosition, cluster.avgPosition);
    existing.cpc = pickPreferredNullableNumber(existing.cpc, cluster.cpc);
    existing.cpm = pickPreferredNullableNumber(existing.cpm, cluster.cpm);
    existing.spend = pickPreferredNullableNumber(existing.spend, cluster.spend);
    existing.bid = pickPreferredNullableNumber(existing.bid, cluster.bid);
    existing.bidSyncStatus = existing.bidSyncStatus ?? cluster.bidSyncStatus;
    existing.bidConfirmedAt = pickLatestIsoDate(existing.bidConfirmedAt, cluster.bidConfirmedAt);
    existing.bidRetryAt = pickLatestIsoDate(existing.bidRetryAt, cluster.bidRetryAt);
    existing.bidLastError = existing.bidLastError ?? cluster.bidLastError;
    existing.actionSyncStatus = existing.actionSyncStatus ?? cluster.actionSyncStatus;
    existing.actionRetryAt = pickLatestIsoDate(existing.actionRetryAt, cluster.actionRetryAt);
    existing.actionLastError = existing.actionLastError ?? cluster.actionLastError;
    existing.queryCount = pickPreferredNullableNumber(existing.queryCount, cluster.queryCount);
    existing.jamQueryCount = pickPreferredNullableNumber(existing.jamQueryCount, cluster.jamQueryCount);
    existing.jamFrequency = pickPreferredNullableNumber(existing.jamFrequency, cluster.jamFrequency);
    existing.jamClicks = pickPreferredNullableNumber(existing.jamClicks, cluster.jamClicks);
    existing.jamAddToCart = pickPreferredNullableNumber(
      existing.jamAddToCart,
      cluster.jamAddToCart,
    );
    existing.jamOrders = pickPreferredNullableNumber(existing.jamOrders, cluster.jamOrders);
    existing.jamAvgPosition = pickPreferredNullableNumber(
      existing.jamAvgPosition,
      cluster.jamAvgPosition,
    );
    existing.monthlyFrequency = pickPreferredNullableNumber(
      existing.monthlyFrequency,
      cluster.monthlyFrequency,
    );
    existing.updatedAt = pickLatestIsoDate(existing.updatedAt, cluster.updatedAt);

    if (
      getAdvertisingSourcePriority(cluster.sourceKind, cluster.isActive) <
      getAdvertisingSourcePriority(existing.sourceKind, existing.isActive)
    ) {
      existing.sourceKind = cluster.sourceKind;
      existing.isActive = cluster.isActive;
    } else if (existing.isActive === null) {
      existing.isActive = cluster.isActive;
    }
  }

  return Array.from(mergedClusters.values());
}

function projectWorkspaceShellClustersForRange(
  rows: WorkspaceShellClusterRow[],
  sheet: ProductAdvertisingSheetResponse,
): WorkspaceShellClusterRow[] {
  if (sheet.summary.periodMetricsStatus !== "exact") {
    return rows.map((row) => ({
      ...row,
      views: null,
      clicks: null,
      orders: null,
      addToCart: null,
      shks: null,
      ctr: null,
      avgPosition: null,
      cpc: null,
      cpm: null,
      spend: null,
    }));
  }

  if (sheet.dailyStats.length === 0) {
    return rows;
  }

  const startDate = sheet.range.startDate;
  const endDate = sheet.range.endDate;
  if (!startDate && !endDate) {
    return rows;
  }

  const aggregates = new Map<
    string,
    {
      views: number | null;
      clicks: number | null;
      orders: number | null;
      addToCart: number | null;
      shks: number | null;
      spend: number | null;
      avgPositions: number[];
      currency: string | null;
      updatedAt: string | null;
    }
  >();

  for (const stat of sheet.dailyStats) {
    if (!isWorkspaceShellStatDateWithinRange(stat, startDate, endDate)) {
      continue;
    }

    const key = `${stat.advertId}:${normalizeWorkspaceShellText(stat.clusterName)}`;
    const aggregate = aggregates.get(key) ?? {
      views: null,
      clicks: null,
      orders: null,
      addToCart: null,
      shks: null,
      spend: null,
      avgPositions: [],
      currency: stat.currency,
      updatedAt: stat.updatedAt,
    };

    aggregate.views = addNullableNumber(aggregate.views, stat.views);
    aggregate.clicks = addNullableNumber(aggregate.clicks, stat.clicks);
    aggregate.orders = addNullableNumber(aggregate.orders, stat.orders);
    aggregate.addToCart = addNullableNumber(aggregate.addToCart, stat.addToCart);
    aggregate.shks = addNullableNumber(aggregate.shks, stat.shks);
    aggregate.spend = addNullableNumber(aggregate.spend, stat.spend);
    aggregate.currency = aggregate.currency ?? stat.currency;
    aggregate.updatedAt = pickLatestIsoDate(aggregate.updatedAt, stat.updatedAt);
    if (typeof stat.avgPosition === "number") {
      aggregate.avgPositions.push(stat.avgPosition);
    }

    aggregates.set(key, aggregate);
  }

  return rows.map((row) => {
    if (row.advertId === null) {
      return row;
    }

    const aggregate = aggregates.get(`${row.advertId}:${normalizeWorkspaceShellText(row.clusterName)}`);
    const views = coerceWorkspaceShellTotal(aggregate?.views);
    const clicks = coerceWorkspaceShellTotal(aggregate?.clicks);
    const orders = coerceWorkspaceShellTotal(aggregate?.orders);
    const addToCart = coerceWorkspaceShellTotal(aggregate?.addToCart);
    const shks = coerceWorkspaceShellTotal(aggregate?.shks);
    const spend = coerceWorkspaceShellTotal(aggregate?.spend);

    return {
      ...row,
      views,
      clicks,
      orders,
      addToCart,
      shks,
      ctr: getAdvertisingRatio(clicks, views),
      avgPosition: averageAdvertisingValues(aggregate?.avgPositions ?? []),
      cpc: getAdvertisingMoneyPerAction(spend, clicks),
      cpm: getAdvertisingCostPerThousand(spend, views),
      spend,
      currency: aggregate?.currency ?? row.currency,
      updatedAt: pickLatestIsoDate(row.updatedAt, aggregate?.updatedAt ?? null),
    };
  });
}

function buildWorkspaceShellCampaignTabs(
  campaigns: ProductAdvertisingSheetResponse["campaigns"],
  rows: WorkspaceShellClusterRow[],
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
      totals: createEmptyWorkspaceShellCampaignTotals(),
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
        totals: createEmptyWorkspaceShellCampaignTotals(),
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
    currentTab.totals.spend = addNullableNumber(currentTab.totals.spend, row.spend);
    currentTab.totals.orders = addNullableNumber(
      currentTab.totals.orders,
      getAdvertisingOrderedItems(row),
    );
    currentTab.totals.clicks = addNullableNumber(currentTab.totals.clicks, row.clicks);
    currentTab.totals.views = addNullableNumber(currentTab.totals.views, row.views);
    currentTab.totals.addToCart = addNullableNumber(
      currentTab.totals.addToCart,
      row.addToCart,
    );

    if (isClusterExcluded(row)) {
      currentTab.totals.excludedCount += 1;
    } else if (isClusterActive(row)) {
      currentTab.totals.activeCount += 1;
    }
  }

  return Array.from(tabs.values())
    .map((tab) => ({
      ...tab,
      totals: {
        ...tab.totals,
        ctr: getAdvertisingRatio(tab.totals.clicks, tab.totals.views),
        ctc: getAdvertisingRatio(tab.totals.addToCart, tab.totals.clicks),
        cto: getAdvertisingRatio(tab.totals.orders, tab.totals.addToCart),
        cpc: getAdvertisingMoneyPerAction(tab.totals.spend, tab.totals.clicks),
        cpm: getAdvertisingCostPerThousand(tab.totals.spend, tab.totals.views),
        cpo: getAdvertisingCpoOrSpend(tab.totals.spend, tab.totals.orders),
        viewToOrder: getAdvertisingRatio(tab.totals.orders, tab.totals.views),
      },
    }))
    .sort((left, right) => {
      const leftSpend = left.totals.spend ?? 0;
      const rightSpend = right.totals.spend ?? 0;
      if (rightSpend !== leftSpend) {
        return rightSpend - leftSpend;
      }

      return getWorkspaceShellCampaignLabel(left).localeCompare(
        getWorkspaceShellCampaignLabel(right),
        "ru",
      );
    });
}

function getWorkspaceShellDailyStatsBounds(
  dailyStats: ProductAdvertisingSheetResponse["dailyStats"],
) {
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const stat of dailyStats) {
    if (!minDate || stat.date < minDate) {
      minDate = stat.date;
    }
    if (!maxDate || stat.date > maxDate) {
      maxDate = stat.date;
    }
  }

  return { minDate, maxDate };
}

export function buildWorkspaceShellClusterKey(advertId: number | null, clusterName: string) {
  return `${advertId ?? "none"}:${normalizeWorkspaceShellText(clusterName)}`;
}

function isWorkspaceShellStatDateWithinRange(
  stat: ProductAdvertisingDailyStat,
  startDate: string | null,
  endDate: string | null,
) {
  if (startDate && stat.date < startDate) {
    return false;
  }

  if (endDate && stat.date > endDate) {
    return false;
  }

  return true;
}

function createEmptyWorkspaceShellCampaignTotals(): ProductAdvertisingWorkspaceCampaignTotals {
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

function getWorkspaceShellCampaignLabel(input: {
  advertId: number;
  campaignName: string | null;
}) {
  if (input.campaignName) {
    return `${input.campaignName} (#${String(input.advertId)})`;
  }

  return `Кампания #${String(input.advertId)}`;
}

function isWorkspaceShellDisplayCluster(row: WorkspaceShellClusterRow) {
  return isClusterActive(row) || isClusterExcluded(row);
}

function normalizeWorkspaceShellText(value: string) {
  return value.trim().toLocaleLowerCase("ru");
}

function pickPreferredNullableNumber(
  currentValue: number | null,
  nextValue: number | null,
) {
  return currentValue ?? nextValue;
}

function addNullableNumber(currentValue: number | null, nextValue: number | null) {
  if (currentValue === null) {
    return nextValue;
  }

  if (nextValue === null) {
    return currentValue;
  }

  return currentValue + nextValue;
}

function coerceWorkspaceShellTotal(value: number | null | undefined) {
  return value ?? 0;
}

function pickLatestIsoDate(currentValue: string | null, nextValue: string | null) {
  if (!currentValue) {
    return nextValue;
  }

  if (!nextValue) {
    return currentValue;
  }

  return Date.parse(nextValue) > Date.parse(currentValue) ? nextValue : currentValue;
}
