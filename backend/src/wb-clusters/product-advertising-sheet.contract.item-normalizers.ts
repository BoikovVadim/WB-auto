import type {
  ProductAdvertisingCampaign,
  ProductAdvertisingCluster,
  ProductAdvertisingClusterQuery,
  ProductAdvertisingDailyStat,
  ProductAdvertisingKeywordStat,
  ProductAdvertisingMinusPhrase,
} from "./types/product-advertising-sheet.types";
import {
  asBoolean,
  asBooleanOrNull,
  asClusterActionSyncStatus,
  asClusterBidSyncStatus,
  asClusterQueryMappingSource,
  asClusterQueryMatchConfidence,
  asClusterQuerySource,
  asClusterSourceKind,
  asIsoDateTime,
  asNonEmptyString,
  asNonEmptyStringOrNull,
  asNumberOrNull,
  isRecord,
  trackRepair,
} from "./product-advertising-sheet.contract.shared";

export function normalizeCampaign(
  value: unknown,
  path: string,
  issues: string[],
): ProductAdvertisingCampaign | null {
  if (!isRecord(value) || typeof value.advertId !== "number") {
    issues.push(`${path} is missing advertId.`);
    return null;
  }

  if (typeof value.campaignType !== "number" || typeof value.campaignStatus !== "number") {
    issues.push(`${path} is missing campaignType/campaignStatus.`);
    return null;
  }

  return {
    advertId: value.advertId,
    campaignType: value.campaignType,
    campaignStatus: value.campaignStatus,
    paymentType: asNonEmptyStringOrNull(value.paymentType),
    bidType: asNonEmptyStringOrNull(value.bidType),
    placementsSearch: typeof value.placementsSearch === "boolean" ? value.placementsSearch : null,
    placementsRecommendations: typeof value.placementsRecommendations === "boolean" ? value.placementsRecommendations : null,
    currency: asNonEmptyStringOrNull(value.currency),
    name: asNonEmptyStringOrNull(value.name),
    subjectId: asNumberOrNull(value.subjectId),
    subjectName: asNonEmptyStringOrNull(value.subjectName),
    changeTime: asIsoDateTime(value.changeTime),
    createdAtWb: asIsoDateTime(value.createdAtWb),
    startedAtWb: asIsoDateTime(value.startedAtWb),
    updatedAtWb: asIsoDateTime(value.updatedAtWb),
    syncedAt: asIsoDateTime(value.syncedAt),
  };
}

export function normalizeCluster(
  value: unknown,
  path: string,
  issues: string[],
): ProductAdvertisingCluster | null {
  if (!isRecord(value)) {
    issues.push(`${path} is not an object.`);
    return null;
  }

  const clusterName = asNonEmptyString(value.clusterName);
  const canonicalNormQuery = asNonEmptyString(value.canonicalNormQuery);
  if (!clusterName || !canonicalNormQuery) {
    issues.push(`${path} is missing clusterName/canonicalNormQuery.`);
    return null;
  }

  return {
    advertId: asNumberOrNull(value.advertId),
    campaignName: asNonEmptyStringOrNull(value.campaignName),
    campaignType: asNumberOrNull(value.campaignType),
    campaignStatus: asNumberOrNull(value.campaignStatus),
    paymentType: asNonEmptyStringOrNull(value.paymentType),
    bidType: asNonEmptyStringOrNull(value.bidType),
    currency: asNonEmptyStringOrNull(value.currency),
    clusterName,
    canonicalNormQuery,
    sourceKind: asClusterSourceKind(value.sourceKind) ?? trackRepair(issues, path, "stats"),
    isActive: asBooleanOrNull(value.isActive),
    views: asNumberOrNull(value.views),
    clicks: asNumberOrNull(value.clicks),
    orders: asNumberOrNull(value.orders),
    addToCart: asNumberOrNull(value.addToCart),
    shks: asNumberOrNull(value.shks),
    ctr: asNumberOrNull(value.ctr),
    avgPosition: asNumberOrNull(value.avgPosition),
    cpc: asNumberOrNull(value.cpc),
    cpm: asNumberOrNull(value.cpm),
    spend: asNumberOrNull(value.spend),
    bid: asNumberOrNull(value.bid),
    bidSyncStatus: asClusterBidSyncStatus(value.bidSyncStatus),
    bidConfirmedAt: asIsoDateTime(value.bidConfirmedAt),
    bidRetryAt: asIsoDateTime(value.bidRetryAt),
    bidLastError: asNonEmptyStringOrNull(value.bidLastError),
    actionSyncStatus: asClusterActionSyncStatus(value.actionSyncStatus),
    actionRetryAt: asIsoDateTime(value.actionRetryAt),
    actionLastError: asNonEmptyStringOrNull(value.actionLastError),
    queryCount: asNumberOrNull(value.queryCount),
    jamQueryCount: asNumberOrNull(value.jamQueryCount),
    jamFrequency: asNumberOrNull(value.jamFrequency),
    jamClicks: asNumberOrNull(value.jamClicks),
    jamAddToCart: asNumberOrNull(value.jamAddToCart),
    jamOrders: asNumberOrNull(value.jamOrders),
    jamAvgPosition: asNumberOrNull(value.jamAvgPosition),
    monthlyFrequency: asNumberOrNull(value.monthlyFrequency),
    updatedAt: asIsoDateTime(value.updatedAt),
  };
}

export function normalizeClusterQuery(
  value: unknown,
  path: string,
  issues: string[],
): ProductAdvertisingClusterQuery | null {
  if (!isRecord(value) || typeof value.advertId !== "number") {
    issues.push(`${path} is missing advertId.`);
    return null;
  }

  const clusterName = asNonEmptyString(value.clusterName);
  const queryText = asNonEmptyString(value.queryText);
  if (!clusterName || !queryText) {
    issues.push(`${path} is missing clusterName/queryText.`);
    return null;
  }

  const mappingSource =
    asClusterQueryMappingSource(value.mappingSource) ??
    (asBoolean(value.isCabinetBacked)
      ? "cabinet"
      : asNonEmptyString(value.querySource) === "cluster-name"
        ? "cluster-name"
        : "promotion");

  return {
    advertId: value.advertId,
    clusterName,
    queryText,
    querySource:
      asClusterQuerySource(value.querySource) ??
      trackRepair(
        issues,
        path,
        mappingSource === "cluster-name" ? "cluster-name" : "query-map",
      ),
    mappingSource,
    matchConfidence:
      asClusterQueryMatchConfidence(value.matchConfidence) ??
      trackRepair(
        issues,
        path,
        mappingSource === "cluster-name" ? "exact" : "trusted-source",
      ),
    isFrequencyBacked: asBoolean(value.isFrequencyBacked),
    isClusterConfirmed:
      typeof value.isClusterConfirmed === "boolean"
        ? value.isClusterConfirmed
        : trackRepair(issues, path, true),
    isCanonicalClusterQuery:
      typeof value.isCanonicalClusterQuery === "boolean"
        ? value.isCanonicalClusterQuery
        : trackRepair(issues, path, true),
    isCabinetBacked:
      typeof value.isCabinetBacked === "boolean"
        ? value.isCabinetBacked
        : trackRepair(issues, path, mappingSource === "cabinet" || mappingSource === "merged"),
    cabinetSnapshotAt: asIsoDateTime(value.cabinetSnapshotAt),
    sourceKind: asClusterSourceKind(value.sourceKind) ?? trackRepair(issues, path, "query-map"),
    isActive: asBooleanOrNull(value.isActive),
    views: asNumberOrNull(value.views),
    clicks: asNumberOrNull(value.clicks),
    orders: asNumberOrNull(value.orders),
    addToCart: asNumberOrNull(value.addToCart),
    shks: asNumberOrNull(value.shks),
    jamFrequency: asNumberOrNull(value.jamFrequency),
    jamClicks: asNumberOrNull(value.jamClicks),
    jamAddToCart: asNumberOrNull(value.jamAddToCart),
    jamOrders: asNumberOrNull(value.jamOrders),
    jamAvgPosition: asNumberOrNull(value.jamAvgPosition),
    jamOpenToCart: asNumberOrNull(value.jamOpenToCart),
    monthlyFrequency: asNumberOrNull(value.monthlyFrequency),
    updatedAt: asIsoDateTime(value.updatedAt),
  };
}

export function normalizeDailyStat(
  value: unknown,
  path: string,
  issues: string[],
): ProductAdvertisingDailyStat | null {
  if (!isRecord(value) || typeof value.advertId !== "number") {
    issues.push(`${path} is missing advertId.`);
    return null;
  }

  const date = asNonEmptyString(value.date);
  const clusterName = asNonEmptyString(value.clusterName);
  if (!date || !clusterName) {
    issues.push(`${path} is missing date/clusterName.`);
    return null;
  }

  return {
    advertId: value.advertId,
    date,
    clusterName,
    views: asNumberOrNull(value.views),
    clicks: asNumberOrNull(value.clicks),
    orders: asNumberOrNull(value.orders),
    addToCart: asNumberOrNull(value.addToCart),
    shks: asNumberOrNull(value.shks),
    ctr: asNumberOrNull(value.ctr),
    avgPosition: asNumberOrNull(value.avgPosition),
    cpc: asNumberOrNull(value.cpc),
    cpm: asNumberOrNull(value.cpm),
    spend: asNumberOrNull(value.spend),
    currency: asNonEmptyStringOrNull(value.currency),
    updatedAt: asIsoDateTime(value.updatedAt),
  };
}

export function normalizeMinusPhrase(
  value: unknown,
  path: string,
  issues: string[],
): ProductAdvertisingMinusPhrase | null {
  if (!isRecord(value) || typeof value.advertId !== "number") {
    issues.push(`${path} is missing advertId.`);
    return null;
  }

  const phrase = asNonEmptyString(value.phrase);
  if (!phrase) {
    issues.push(`${path} is missing phrase.`);
    return null;
  }

  return {
    advertId: value.advertId,
    phrase,
    updatedAt: asIsoDateTime(value.updatedAt),
  };
}

export function normalizeKeywordStat(
  value: unknown,
  path: string,
  issues: string[],
): ProductAdvertisingKeywordStat | null {
  if (!isRecord(value) || typeof value.advertId !== "number") {
    issues.push(`${path} is missing advertId.`);
    return null;
  }

  const date = asNonEmptyString(value.date);
  const keyword = asNonEmptyString(value.keyword);
  if (!date || !keyword) {
    issues.push(`${path} is missing date/keyword.`);
    return null;
  }

  return {
    advertId: value.advertId,
    date,
    keyword,
    views: asNumberOrNull(value.views),
    clicks: asNumberOrNull(value.clicks),
    ctr: asNumberOrNull(value.ctr),
    spend: asNumberOrNull(value.spend),
    currency: asNonEmptyStringOrNull(value.currency),
    updatedAt: asIsoDateTime(value.updatedAt),
  };
}
