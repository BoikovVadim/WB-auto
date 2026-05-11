import type {
  ProductAdvertisingSheetJamOverlay,
} from "./product-advertising-sheet.builder";
import type { ProductAdvertisingSheetResponse } from "./types/product-advertising-sheet.types";

import {
  buildAggregateSafeClusterFrequencyGroupKey,
  buildAggregateSafeClusterFrequencyIndex,
} from "./product-advertising-sheet.frequency";
import {
  buildAdvertisingSheetJamGroupKey,
  buildAdvertisingSheetJamQueryKey,
} from "./product-advertising-sheet.snapshot.jam.keys";

export function enrichProductAdvertisingSheetWithJam(input: {
  sheet: ProductAdvertisingSheetResponse;
  overlay: ProductAdvertisingSheetJamOverlay;
  normalizeAdvertisingText: (value: string) => string;
}) {
  const existingQueryKeys = new Set(
    input.sheet.clusterQueries.map((query) =>
      buildAdvertisingSheetJamQueryKey(
        query.advertId,
        query.clusterName,
        query.queryText,
        input.normalizeAdvertisingText,
      ),
    ),
  );
  const appendedQueries = input.overlay.extraQueries.filter(
    (query) =>
      !existingQueryKeys.has(
        buildAdvertisingSheetJamQueryKey(
          query.advertId,
          query.clusterName,
          query.queryText,
          input.normalizeAdvertisingText,
        ),
      ),
  );
  const nextClusterQueries = [
    ...input.sheet.clusterQueries.map((query) => {
      const metrics =
        input.overlay.queryMetricsByKey.get(
          buildAdvertisingSheetJamQueryKey(
            query.advertId,
            query.clusterName,
            query.queryText,
            input.normalizeAdvertisingText,
          ),
        ) ?? null;

      return {
        ...query,
        jamFrequency: metrics?.jamFrequency ?? null,
        jamClicks: metrics?.jamClicks ?? null,
        jamAddToCart: metrics?.jamAddToCart ?? null,
        jamOrders: metrics?.jamOrders ?? null,
        jamAvgPosition: metrics?.jamAvgPosition ?? null,
        jamOpenToCart: metrics?.jamOpenToCart ?? null,
      };
    }),
    ...appendedQueries,
  ];
  const queryCountByGroup = new Map<string, number>();
  for (const query of nextClusterQueries) {
    const groupKey = buildAdvertisingSheetJamGroupKey(
      query.advertId,
      query.clusterName,
      input.normalizeAdvertisingText,
    );
    queryCountByGroup.set(groupKey, (queryCountByGroup.get(groupKey) ?? 0) + 1);
  }
  const monthlyFrequencyByGroup = buildAggregateSafeClusterFrequencyIndex({
    clusterQueries: nextClusterQueries,
    normalizeAdvertisingText: input.normalizeAdvertisingText,
  });
  const campaignByAdvertId = new Map(
    input.sheet.campaigns.map((campaign) => [campaign.advertId, campaign]),
  );
  const existingClusterKeys = new Set(
    input.sheet.clusters
      .filter((cluster): cluster is typeof cluster & { advertId: number } => cluster.advertId !== null)
      .map((cluster) =>
        buildAdvertisingSheetJamGroupKey(
          cluster.advertId,
          cluster.clusterName,
          input.normalizeAdvertisingText,
        ),
      ),
  );
  const syntheticClusters = new Map<string, ProductAdvertisingSheetResponse["clusters"][number]>();
  for (const query of appendedQueries) {
    const groupKey = buildAdvertisingSheetJamGroupKey(
      query.advertId,
      query.clusterName,
      input.normalizeAdvertisingText,
    );
    const aggregateFrequencyGroupKey = buildAggregateSafeClusterFrequencyGroupKey(
      query.advertId,
      query.clusterName,
      input.normalizeAdvertisingText,
    );
    if (existingClusterKeys.has(groupKey) || syntheticClusters.has(groupKey)) {
      continue;
    }

    const metrics = input.overlay.clusterMetricsByKey.get(groupKey) ?? null;
    const campaign = campaignByAdvertId.get(query.advertId) ?? null;
    syntheticClusters.set(groupKey, {
      advertId: query.advertId,
      campaignName: campaign?.name ?? null,
      campaignType: campaign?.campaignType ?? null,
      campaignStatus: campaign?.campaignStatus ?? null,
      paymentType: campaign?.paymentType ?? null,
      bidType: campaign?.bidType ?? null,
      currency: campaign?.currency ?? null,
      clusterName: query.clusterName,
      canonicalNormQuery: query.clusterName,
      sourceKind: query.sourceKind,
      isActive: query.isActive,
      views: query.views,
      clicks: query.clicks,
      orders: query.orders,
      addToCart: query.addToCart,
      shks: query.shks,
      ctr: null,
      avgPosition: null,
      cpc: null,
      cpm: null,
      spend: null,
      bid: null,
      bidSyncStatus: null,
      bidConfirmedAt: null,
      bidRetryAt: null,
      bidLastError: null,
      actionSyncStatus: null,
      actionRetryAt: null,
      actionLastError: null,
      queryCount: queryCountByGroup.get(groupKey) ?? null,
      jamQueryCount: metrics?.jamQueryCount ?? null,
      jamFrequency: metrics?.jamFrequency ?? null,
      jamClicks: metrics?.jamClicks ?? null,
      jamAddToCart: metrics?.jamAddToCart ?? null,
      jamOrders: metrics?.jamOrders ?? null,
      jamAvgPosition: metrics?.jamAvgPosition ?? null,
      monthlyFrequency: monthlyFrequencyByGroup.get(aggregateFrequencyGroupKey) ?? null,
      updatedAt: query.updatedAt,
    });
  }
  const nextClusters = [
    ...input.sheet.clusters.map((cluster) => {
      const metrics =
        cluster.advertId === null
          ? null
          : input.overlay.clusterMetricsByKey.get(
              buildAdvertisingSheetJamGroupKey(
                cluster.advertId,
                cluster.clusterName,
                input.normalizeAdvertisingText,
              ),
            ) ?? null;
      const groupKey =
        cluster.advertId === null
          ? null
          : buildAdvertisingSheetJamGroupKey(
              cluster.advertId,
              cluster.clusterName,
              input.normalizeAdvertisingText,
            );
      const aggregateFrequencyGroupKey =
        cluster.advertId === null
          ? null
          : buildAggregateSafeClusterFrequencyGroupKey(
              cluster.advertId,
              cluster.clusterName,
              input.normalizeAdvertisingText,
            );

      return {
        ...cluster,
        queryCount: groupKey ? (queryCountByGroup.get(groupKey) ?? cluster.queryCount) : cluster.queryCount,
        jamQueryCount: metrics?.jamQueryCount ?? null,
        jamFrequency: metrics?.jamFrequency ?? null,
        jamClicks: metrics?.jamClicks ?? null,
        jamAddToCart: metrics?.jamAddToCart ?? null,
        jamOrders: metrics?.jamOrders ?? null,
        jamAvgPosition: metrics?.jamAvgPosition ?? null,
        monthlyFrequency:
          cluster.monthlyFrequency ??
          (groupKey && aggregateFrequencyGroupKey && monthlyFrequencyByGroup.has(aggregateFrequencyGroupKey)
            ? monthlyFrequencyByGroup.get(aggregateFrequencyGroupKey) ?? null
            : null),
      };
    }),
    ...Array.from(syntheticClusters.values()),
  ];
  const nextSummary = {
    ...input.sheet.summary,
    clustersCount: nextClusters.length,
    clusterQueriesCount: nextClusterQueries.length,
    queryCoverageStatus:
      nextClusterQueries.length > 0
        ? input.sheet.summary.queryCoverageStatus === "partial"
          ? "partial"
          : "ready"
        : nextClusters.length > 0
          ? "missing-query-map"
          : "no-clusters",
    queryCoverageReason:
      nextClusterQueries.length > 0
        ? null
        : nextClusters.length > 0
          ? input.sheet.summary.queryCoverageReason
          : null,
    dailyStatsCoverageStatus: input.sheet.summary.dailyStatsCoverageStatus,
    dailyStatsCoverageReason: input.sheet.summary.dailyStatsCoverageReason,
    dailyStatsWindowStartDate: input.sheet.summary.dailyStatsWindowStartDate,
    dailyStatsWindowEndDate: input.sheet.summary.dailyStatsWindowEndDate,
    periodMetricsStatus: input.sheet.summary.periodMetricsStatus,
    periodMetricsReason: input.sheet.summary.periodMetricsReason,
    periodMetricsActualStartDate: input.sheet.summary.periodMetricsActualStartDate,
    periodMetricsActualEndDate: input.sheet.summary.periodMetricsActualEndDate,
  } satisfies ProductAdvertisingSheetResponse["summary"];

  return {
    ...input.sheet,
    summary: nextSummary,
    clusters: nextClusters,
    clusterQueries: nextClusterQueries,
  };
}
