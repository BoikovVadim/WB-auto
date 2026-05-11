import type {
  RawAdvertisingSheetClusterQueryRow,
  RawAdvertisingSheetClusterRow,
} from "./wb-clusters.repository.types";

import { WbClustersRepositoryAdvertisingQueryCoverage } from "./wb-clusters.repository.advertising-query-coverage";

export abstract class WbClustersRepositoryAdvertisingQueryRowMerging extends WbClustersRepositoryAdvertisingQueryCoverage {
  protected async mergeAuthoritativeAdvertisingQueryRows(
    rawQueries: RawAdvertisingSheetClusterQueryRow[],
  ) {
    const BATCH_SIZE = 5_000;
    const mergedRows = new Map<string, RawAdvertisingSheetClusterQueryRow>();

    for (let i = 0; i < rawQueries.length; i++) {
      if (i > 0 && i % BATCH_SIZE === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const row = rawQueries[i];
      const key = this.buildAdvertisingQueryIdentityKey(
        row.advertId,
        row.normalizedClusterName,
        row.normalizedQueryText,
      );
      const existingRow = mergedRows.get(key);
      if (!existingRow) {
        mergedRows.set(key, row);
        continue;
      }

      mergedRows.set(key, this.mergeAdvertisingQueryRows(existingRow, row));
    }

    return Array.from(mergedRows.values()).sort((left, right) =>
      this.compareLookupMatchPriority(left, right),
    );
  }

  protected hydrateAdvertisingSheetClustersFromQueryRows(
    rawClusters: RawAdvertisingSheetClusterRow[],
    rawQueries: RawAdvertisingSheetClusterQueryRow[],
    campaigns: Array<{
      advertId: number;
      campaignType: number;
      campaignStatus: number;
      paymentType: string | null;
      bidType: string | null;
      currency: string | null;
      name: string | null;
      updatedAt: string | null;
    }>,
  ) {
    if (rawQueries.length === 0) {
      return rawClusters;
    }

    const campaignByAdvertId = new Map(campaigns.map((campaign) => [campaign.advertId, campaign]));
    const clusterRowsByKey = new Map(
      rawClusters
        .filter((cluster): cluster is RawAdvertisingSheetClusterRow & { advertId: number } => cluster.advertId !== null)
        .map((cluster) => [
          `${cluster.advertId}:${cluster.normalizedClusterName}`,
          cluster,
        ]),
    );

    for (const query of rawQueries) {
      const clusterKey = `${query.advertId}:${query.normalizedClusterName}`;
      if (clusterRowsByKey.has(clusterKey)) {
        continue;
      }

      const campaign = campaignByAdvertId.get(query.advertId) ?? null;
      clusterRowsByKey.set(clusterKey, {
        advertId: query.advertId,
        campaignName: campaign?.name ?? null,
        campaignType: campaign?.campaignType ?? null,
        campaignStatus: campaign?.campaignStatus ?? null,
        paymentType: campaign?.paymentType ?? null,
        bidType: campaign?.bidType ?? null,
        currency: campaign?.currency ?? null,
        clusterName: query.clusterName,
        normalizedClusterName: query.normalizedClusterName,
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
        monthlyFrequency: query.monthlyFrequency,
        updatedAt: this.pickLatestIsoDate(query.updatedAt, campaign?.updatedAt ?? null),
      });
    }

    // Build a Set of existing cluster keys for O(1) lookup instead of O(n) .some()
    const existingClusterKeySet = new Set<string>(
      rawClusters
        .filter((c): c is RawAdvertisingSheetClusterRow & { advertId: number } => c.advertId !== null)
        .map((c) => `${c.advertId}:${c.normalizedClusterName}`),
    );

    return [
      ...rawClusters,
      ...Array.from(clusterRowsByKey.values()).filter(
        (cluster) => !existingClusterKeySet.has(`${cluster.advertId}:${cluster.normalizedClusterName}`),
      ),
    ];
  }

  protected mergeAdvertisingQueryRows(
    left: RawAdvertisingSheetClusterQueryRow,
    right: RawAdvertisingSheetClusterQueryRow,
  ): RawAdvertisingSheetClusterQueryRow {
    const preferredRow = this.compareLookupMatchPriority(left, right) <= 0 ? left : right;
    const secondaryRow = preferredRow === left ? right : left;

    return {
      ...preferredRow,
      clusterName:
        preferredRow.clusterName.trim().length > 0
          ? preferredRow.clusterName
          : secondaryRow.clusterName,
      queryText:
        preferredRow.queryText.trim().length > 0 ? preferredRow.queryText : secondaryRow.queryText,
      normalizedClusterName: preferredRow.normalizedClusterName,
      normalizedQueryText: preferredRow.normalizedQueryText,
      mappingSource: this.mergeAdvertisingQueryMappingSource(
        left.mappingSource,
        right.mappingSource,
      ),
      isCabinetBacked: left.isCabinetBacked || right.isCabinetBacked,
      cabinetSnapshotAt:
        preferredRow.cabinetSnapshotAt ?? secondaryRow.cabinetSnapshotAt ?? null,
      sourceKind: this.pickPreferredSourceKind(left.sourceKind, right.sourceKind),
      isActive:
        preferredRow.isActive ?? secondaryRow.isActive ?? left.isActive ?? right.isActive ?? null,
      views: this.pickPreferredNumber(left.views, right.views),
      clicks: this.pickPreferredNumber(left.clicks, right.clicks),
      orders: this.pickPreferredNumber(left.orders, right.orders),
      addToCart: this.pickPreferredNumber(left.addToCart, right.addToCart),
      shks: this.pickPreferredNumber(left.shks, right.shks),
      monthlyFrequency: this.pickPreferredNumber(left.monthlyFrequency, right.monthlyFrequency),
      updatedAt: this.pickLatestIsoDate(left.updatedAt, right.updatedAt),
    };
  }

}
