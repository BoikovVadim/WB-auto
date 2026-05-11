import type { ProductAdvertisingSheetResponse } from "./wb-clusters.types";
import { isWorkspaceStatDateWithinRange, pickLatestIsoDate } from "./product-workspace.builder.dates";
import {
  addWorkspaceNullableNumbers,
  averageWorkspaceNumbers,
  coerceWorkspaceTotal,
  getWorkspaceCostPerThousand,
  getWorkspaceMoneyPerAction,
  getWorkspaceRatio,
  pickPreferredNullableNumber,
} from "./product-workspace.builder.math";
import { getWorkspaceSourcePriority, normalizeWorkspaceText } from "./product-workspace.builder.sources";

type WorkspaceClusterRow = ProductAdvertisingSheetResponse["clusters"][number];

export function mergeWorkspaceClusters(
  clusters: ProductAdvertisingSheetResponse["clusters"],
): WorkspaceClusterRow[] {
  const mergedClusters = new Map<string, WorkspaceClusterRow>();

  for (const cluster of clusters) {
    const key = `${cluster.advertId ?? "none"}:${normalizeWorkspaceText(cluster.clusterName)}`;
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
    existing.jamQueryCount = pickPreferredNullableNumber(existing.jamQueryCount, cluster.jamQueryCount);
    existing.jamFrequency = pickPreferredNullableNumber(existing.jamFrequency, cluster.jamFrequency);
    existing.jamClicks = pickPreferredNullableNumber(existing.jamClicks, cluster.jamClicks);
    existing.jamAddToCart = pickPreferredNullableNumber(existing.jamAddToCart, cluster.jamAddToCart);
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
      getWorkspaceSourcePriority(cluster.sourceKind, cluster.isActive) <
      getWorkspaceSourcePriority(existing.sourceKind, existing.isActive)
    ) {
      existing.sourceKind = cluster.sourceKind;
      existing.isActive = cluster.isActive;
    } else if (existing.isActive === null) {
      existing.isActive = cluster.isActive;
    }
  }

  return Array.from(mergedClusters.values());
}

export function projectWorkspaceClustersForRange(
  rows: WorkspaceClusterRow[],
  sheet: ProductAdvertisingSheetResponse,
): WorkspaceClusterRow[] {
  if (sheet.summary.periodMetricsStatus === "unavailable") {
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
    if (!isWorkspaceStatDateWithinRange(stat, startDate, endDate)) {
      continue;
    }

    const key = `${stat.advertId}:${normalizeWorkspaceText(stat.clusterName)}`;
    let aggregate = aggregates.get(key);
    if (!aggregate) {
      aggregate = {
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
      aggregates.set(key, aggregate);
    }

    aggregate.views = addWorkspaceNullableNumbers(aggregate.views, stat.views);
    aggregate.clicks = addWorkspaceNullableNumbers(aggregate.clicks, stat.clicks);
    aggregate.orders = addWorkspaceNullableNumbers(aggregate.orders, stat.orders);
    aggregate.addToCart = addWorkspaceNullableNumbers(aggregate.addToCart, stat.addToCart);
    aggregate.shks = addWorkspaceNullableNumbers(aggregate.shks, stat.shks);
    aggregate.spend = addWorkspaceNullableNumbers(aggregate.spend, stat.spend);
    aggregate.currency = aggregate.currency ?? stat.currency;
    aggregate.updatedAt = pickLatestIsoDate(aggregate.updatedAt, stat.updatedAt);
    if (typeof stat.avgPosition === "number") {
      aggregate.avgPositions.push(stat.avgPosition);
    }
  }

  return rows.map((row) => {
    if (row.advertId === null) {
      return row;
    }

    const aggregate = aggregates.get(`${row.advertId}:${normalizeWorkspaceText(row.clusterName)}`);
    const views = aggregate ? coerceWorkspaceTotal(aggregate.views) : 0;
    const clicks = aggregate ? coerceWorkspaceTotal(aggregate.clicks) : 0;
    const orders = aggregate ? coerceWorkspaceTotal(aggregate.orders) : 0;
    const addToCart = aggregate ? coerceWorkspaceTotal(aggregate.addToCart) : 0;
    const shks = aggregate ? coerceWorkspaceTotal(aggregate.shks) : 0;
    const spend = aggregate ? coerceWorkspaceTotal(aggregate.spend) : 0;

    return {
      ...row,
      views,
      clicks,
      orders,
      addToCart,
      shks,
      ctr: getWorkspaceRatio(clicks, views),
      avgPosition: aggregate ? averageWorkspaceNumbers(aggregate.avgPositions) : null,
      cpc: getWorkspaceMoneyPerAction(spend, clicks),
      cpm: getWorkspaceCostPerThousand(spend, views),
      spend,
      currency: aggregate?.currency ?? row.currency,
      updatedAt: pickLatestIsoDate(row.updatedAt, aggregate?.updatedAt ?? null),
    };
  });
}
