import { withProductAdvertisingDailyStatsCoverageMeta } from "./product-advertising-sheet.response";
import type {
  RawAdvertisingSheetClusterQueryRow,
  RawAdvertisingSheetClusterRow,
} from "./wb-clusters.repository.types";
import type { ProductAdvertisingSheetResponse } from "./wb-clusters.types";
import {
  buildAggregateSafeClusterFrequencyGroupKey,
  buildAggregateSafeClusterFrequencyIndex,
} from "./product-advertising-sheet.frequency";
import { WbClustersRepositoryAdvertisingSheetQueryLoader } from "./wb-clusters.repository.advertising-sheet-query-loader";

export abstract class WbClustersRepositoryAdvertisingSheetBuilder extends WbClustersRepositoryAdvertisingSheetQueryLoader {
  protected async buildProductAdvertisingSheetReadModel(input: {
    nmId: number;
    currentPeriod?: { start: string; end: string } | null;
  }): Promise<ProductAdvertisingSheetResponse> {
    const nmId = input.nmId;
    const currentPeriod = input.currentPeriod ?? null;
    const {
      campaignsResult,
      clustersResult,
      clusterQueriesResult,
      cabinetClusterQueriesResult,
      dailyStatsResult,
      minusPhrasesResult,
      keywordStatsResult,
    } = await this.loadProductAdvertisingSheetSourceData(nmId, currentPeriod);
// Yield after heavy DB fetch so other HTTP handlers can run before we start
// the synchronous CPU-bound processing phase.
await new Promise<void>((resolve) => setImmediate(resolve));
const rawClustersFromTable: RawAdvertisingSheetClusterRow[] = clustersResult.rows.map((row) => ({
  advertId: row.advert_id === null ? null : Number(row.advert_id),
  campaignName: row.campaign_name,
  campaignType: row.campaign_type,
  campaignStatus: row.campaign_status,
  paymentType: row.payment_type,
  bidType: row.bid_type,
  currency: row.currency,
  clusterName: row.cluster_name,
  normalizedClusterName: row.normalized_cluster_name,
  canonicalNormQuery: row.canonical_norm_query,
  sourceKind: row.source_kind,
  isActive: row.is_active,
  views: this.toNullableNumber(row.views),
  clicks: this.toNullableNumber(row.clicks),
  orders: this.toNullableNumber(row.orders),
  addToCart: this.toNullableNumber(row.add_to_cart),
  shks: this.toNullableNumber(row.shks),
  ctr: this.toNullableNumber(row.ctr),
  avgPosition: this.toNullableNumber(row.avg_position),
  cpc: this.toNullableNumber(row.cpc),
  cpm: this.toNullableNumber(row.cpm),
  spend: this.toNullableNumber(row.spend),
  bid: this.toNullableNumber(row.bid),
  bidSyncStatus: row.bid_sync_status,
  bidConfirmedAt: row.bid_confirmed_at,
  bidRetryAt: row.bid_retry_at,
  bidLastError: row.bid_last_error,
  actionSyncStatus: row.action_sync_status,
  actionRetryAt: row.action_retry_at,
  actionLastError: row.action_last_error,
  monthlyFrequency: this.toNullableNumber(row.monthly_frequency),
  updatedAt: row.updated_at,
}));
const preferredQueryRows = new Map<string, RawAdvertisingSheetClusterQueryRow>();

for (const row of clusterQueriesResult.rows) {
  const mappedRow: RawAdvertisingSheetClusterQueryRow = {
    advertId: Number(row.advert_id),
    clusterName: row.cluster_name,
    normalizedClusterName: row.normalized_cluster_name,
    queryText: row.query_text,
    normalizedQueryText: row.normalized_query_text,
    mappingSource: "promotion",
    isCabinetBacked: false,
    cabinetSnapshotAt: null,
    sourceKind: row.source_kind,
    isActive: row.is_active,
    views: this.toNullableNumber(row.views),
    clicks: this.toNullableNumber(row.clicks),
    orders: this.toNullableNumber(row.orders),
    addToCart: this.toNullableNumber(row.add_to_cart),
    shks: this.toNullableNumber(row.shks),
    monthlyFrequency: this.toNullableNumber(row.monthly_frequency),
    updatedAt: row.updated_at,
  };
  preferredQueryRows.set(
    `${mappedRow.advertId}:${mappedRow.normalizedClusterName}:${mappedRow.normalizedQueryText}`,
    mappedRow,
  );
}

for (const row of cabinetClusterQueriesResult.rows) {
  const mappedRow: RawAdvertisingSheetClusterQueryRow = {
    advertId: Number(row.advert_id),
    clusterName: row.cluster_name,
    normalizedClusterName: row.normalized_cluster_name,
    queryText: row.query_text,
    normalizedQueryText: row.normalized_query_text,
    mappingSource: "cabinet",
    isCabinetBacked: true,
    cabinetSnapshotAt: row.captured_at,
    sourceKind: row.source_kind,
    isActive: row.is_active,
    views: this.toNullableNumber(row.views),
    clicks: this.toNullableNumber(row.clicks),
    orders: this.toNullableNumber(row.orders),
    addToCart: this.toNullableNumber(row.add_to_cart),
    shks: this.toNullableNumber(row.shks),
    monthlyFrequency: this.toNullableNumber(row.monthly_frequency),
    updatedAt: row.updated_at,
  };
  preferredQueryRows.set(
    `${mappedRow.advertId}:${mappedRow.normalizedClusterName}:${mappedRow.normalizedQueryText}`,
    mappedRow,
  );
}

// Строим множество идентичностей (punctuation-stripped) имён кластеров по всем
// кампаниям товара. Запросы, чья identity совпадает с именем какого-либо кластера,
// удаляем из отображения (и из агрегации частоты), чтобы не дублировать данные.
// Сравнение по identity (а не по точному normalized тексту) ловит пунктуационные
// варианты — например, кластер "платье женское" и запрос-член "платье, женское"
// теперь считаются дублем. Должно оставаться согласовано с SQL-фильтром в
// buildCanonicalClusterQueriesCte (advertising-sheet-core-query-loader.ts).
// Исключение: представительный запрос кластера (identity имени = identity запроса).
// Yield between processing stages so the event loop stays responsive.
await new Promise<void>((resolve) => setImmediate(resolve));
const allClusterIdentitySet = new Set<string>(
  rawClustersFromTable.map((r) => this.normalizeAdvertisingIdentity(r.normalizedClusterName)),
);
const clusterFilteredQueryRows = Array.from(preferredQueryRows.values()).filter((row) => {
  const clusterIdentity = this.normalizeAdvertisingIdentity(row.normalizedClusterName);
  const queryIdentity = this.normalizeAdvertisingIdentity(row.normalizedQueryText);
  const isSelfRepresentative = clusterIdentity === queryIdentity;
  const isOtherClusterName =
    !isSelfRepresentative && allClusterIdentitySet.has(queryIdentity);
  return !isOtherClusterName;
});
// Дедуп по identity внутри (advertId, кластер): WB может присылать несколько
// текстовых вариантов одного запроса ("клетка для собак", "Клетка, для собак",
// "клетка-для-собак") в wb_cluster_queries / wb_cabinet_cluster_queries. У них
// одна identity и одна строка в wb_search_query_frequencies — identity-JOIN
// присваивает им одинаковую частоту, и без дедупа сумма дочерних умножается на
// число дублей, а строка кластера агрегирует identity один раз. Оставляем одного
// представителя: предпочитаем «канонический» вариант, у которого normalized text
// уже совпадает с identity (т.е. лишней пунктуации нет); при равенстве — первый.
const identityRepresentativeByKey = new Map<string, typeof clusterFilteredQueryRows[number]>();
for (const row of clusterFilteredQueryRows) {
  const clusterIdentity = this.normalizeAdvertisingIdentity(row.normalizedClusterName);
  const queryIdentity = this.normalizeAdvertisingIdentity(row.normalizedQueryText);
  const key = `${row.advertId}:${clusterIdentity}:${queryIdentity}`;
  const existing = identityRepresentativeByKey.get(key);
  if (!existing) {
    identityRepresentativeByKey.set(key, row);
    continue;
  }
  const existingIsCanonical = existing.normalizedQueryText === queryIdentity;
  const candidateIsCanonical = row.normalizedQueryText === queryIdentity;
  if (!existingIsCanonical && candidateIsCanonical) {
    identityRepresentativeByKey.set(key, row);
  }
}
const deduplicatedQueryRows = Array.from(identityRepresentativeByKey.values());
// mergeAuthoritativeAdvertisingQueryRows and buildCanonicalAdvertisingClusterQueries
// are now async and yield the event loop every batch so user requests are not
// blocked during large (e.g. 190 k-row) datasets.
const authoritativeQueryRows = await this.mergeAuthoritativeAdvertisingQueryRows(
  deduplicatedQueryRows,
);
await new Promise<void>((resolve) => setImmediate(resolve));
const rawClusters = this.hydrateAdvertisingSheetClustersFromQueryRows(
  rawClustersFromTable,
  authoritativeQueryRows,
  campaignsResult.rows.map((row) => ({
    advertId: Number(row.advert_id),
    campaignType: row.campaign_type,
    campaignStatus: row.campaign_status,
    paymentType: row.payment_type,
    bidType: row.bid_type,
    currency: row.currency,
    name: row.name,
    updatedAt: row.synced_at,
  })),
);
await new Promise<void>((resolve) => setImmediate(resolve));
const canonicalClusterQueries = await this.buildCanonicalAdvertisingClusterQueries(
  rawClusters,
  authoritativeQueryRows,
);
await new Promise<void>((resolve) => setImmediate(resolve));
const queryCoverage = this.buildProductAdvertisingQueryCoverageSummary(
  rawClusters,
  authoritativeQueryRows,
  canonicalClusterQueries,
);
await new Promise<void>((resolve) => setImmediate(resolve));
const canonicalClusterCountByKey = new Map<string, number>();
const canonicalClusterFrequencyByKey = buildAggregateSafeClusterFrequencyIndex({
  clusterQueries: canonicalClusterQueries,
  normalizeAdvertisingText: (value) => this.normalizeAdvertisingIdentity(value),
});

for (const query of canonicalClusterQueries) {
  if (!this.isAggregateSafeAdvertisingClusterQuery(query)) {
    continue;
  }

  const key = this.buildScopedTextKey(query.advertId, nmId, query.clusterName);
  canonicalClusterCountByKey.set(key, (canonicalClusterCountByKey.get(key) ?? 0) + 1);
}

await new Promise<void>((resolve) => setImmediate(resolve));
const response: ProductAdvertisingSheetResponse = {
  nmId,
  checkedAt: new Date().toISOString(),
  snapshot: this.createEmptyProductAdvertisingSheet(nmId).snapshot,
  range: {
    startDate: currentPeriod?.start ?? null,
    endDate: currentPeriod?.end ?? null,
    jamIncluded: false,
    jamStatus: "not_requested",
  },
  summary: {
    campaignsCount: campaignsResult.rows.length,
    clustersCount: clustersResult.rows.length,
    clusterQueriesCount: canonicalClusterQueries.length,
    dailyStatsCount: dailyStatsResult.rows.length,
    minusPhrasesCount: minusPhrasesResult.rows.length,
    keywordStatsCount: keywordStatsResult.rows.length,
    queryCoverageStatus: queryCoverage.queryCoverageStatus,
    queryCoverageReason: queryCoverage.queryCoverageReason,
    dailyStatsCoverageStatus: "not_requested",
    dailyStatsCoverageReason: null,
    dailyStatsWindowStartDate: null,
    dailyStatsWindowEndDate: null,
    periodMetricsStatus: "unavailable",
    periodMetricsReason: null,
    periodMetricsActualStartDate: null,
    periodMetricsActualEndDate: null,
  },
  campaigns: campaignsResult.rows.map((row) => ({
    advertId: Number(row.advert_id),
    campaignType: row.campaign_type,
    campaignStatus: row.campaign_status,
    paymentType: row.payment_type,
    bidType: row.bid_type,
    placementsSearch: row.placements_search,
    placementsRecommendations: row.placements_recommendations,
    currency: row.currency,
    name: row.name,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    changeTime: row.change_time,
    createdAtWb: row.created_at_wb,
    startedAtWb: row.started_at_wb,
    updatedAtWb: row.updated_at_wb,
    syncedAt: row.synced_at,
  })),
  clusters: rawClusters.map((row) => ({
    advertId: row.advertId,
    campaignName: row.campaignName,
    campaignType: row.campaignType,
    campaignStatus: row.campaignStatus,
    paymentType: row.paymentType,
    bidType: row.bidType,
    currency: row.currency,
    clusterName: row.clusterName,
    canonicalNormQuery: row.canonicalNormQuery,
    sourceKind: row.sourceKind,
    isActive: row.isActive,
    views: row.views,
    clicks: row.clicks,
    orders: row.orders,
    addToCart: row.addToCart,
    shks: row.shks,
    ctr: row.ctr,
    avgPosition: row.avgPosition,
    cpc: row.cpc,
    cpm: row.cpm,
    spend: row.spend,
    bid: row.bid,
    bidSyncStatus: row.bidSyncStatus,
    bidConfirmedAt: row.bidConfirmedAt,
    bidRetryAt: row.bidRetryAt,
    bidLastError: row.bidLastError,
    actionSyncStatus: row.actionSyncStatus,
    actionRetryAt: row.actionRetryAt,
    actionLastError: row.actionLastError,
    queryCount:
      row.advertId === null
        ? null
        : canonicalClusterCountByKey.get(
            this.buildScopedTextKey(row.advertId, nmId, row.clusterName),
          ) ?? 0,
    jamQueryCount: null,
    jamFrequency: null,
    jamClicks: null,
    jamAddToCart: null,
    jamOrders: null,
    jamAvgPosition: null,
    monthlyFrequency:
      row.advertId === null
        ? row.monthlyFrequency
        : row.monthlyFrequency ??
          canonicalClusterFrequencyByKey.get(
            buildAggregateSafeClusterFrequencyGroupKey(
              row.advertId,
              row.clusterName,
              (value) => this.normalizeAdvertisingIdentity(value),
            ),
          ) ??
          null,
    updatedAt: row.updatedAt,
  })),
  clusterQueries: canonicalClusterQueries,
  dailyStats: dailyStatsResult.rows.map((row) => ({
    advertId: Number(row.advert_id),
    date: row.stat_date,
    clusterName: row.cluster_name,
    views: this.toNullableNumber(row.views),
    clicks: this.toNullableNumber(row.clicks),
    orders: this.toNullableNumber(row.orders),
    addToCart: this.toNullableNumber(row.add_to_cart),
    shks: this.toNullableNumber(row.shks),
    ctr: this.toNullableNumber(row.ctr),
    avgPosition: this.toNullableNumber(row.avg_position),
    cpc: this.toNullableNumber(row.cpc),
    cpm: this.toNullableNumber(row.cpm),
    spend: this.toNullableNumber(row.spend),
    currency: row.currency,
    updatedAt: row.updated_at,
  })),
  minusPhrases: minusPhrasesResult.rows.map((row) => ({
    advertId: Number(row.advert_id),
    phrase: row.phrase,
    updatedAt: row.updated_at,
  })),
  keywordStats: keywordStatsResult.rows.map((row) => ({
    advertId: Number(row.advert_id),
    date: row.stat_date,
    keyword: row.keyword,
    views: this.toNullableNumber(row.views),
    clicks: this.toNullableNumber(row.clicks),
    ctr: this.toNullableNumber(row.ctr),
    spend: this.toNullableNumber(row.spend),
    currency: row.currency,
    updatedAt: row.updated_at,
  })),
};

    await new Promise<void>((resolve) => setImmediate(resolve));
    return withProductAdvertisingDailyStatsCoverageMeta(response, {
      startDate: currentPeriod?.start ?? null,
      endDate: currentPeriod?.end ?? null,
    });
  }
}
