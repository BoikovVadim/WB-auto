import type {
  ProductAdvertisingCampaign,
  ProductAdvertisingCluster,
  ProductAdvertisingClusterQuery,
  ProductAdvertisingDailyStat,
  ProductAdvertisingKeywordStat,
  ProductAdvertisingMinusPhrase,
  ProductClusterLookupMatch,
} from "./syncClientTypes";
import {
  isNonEmptyString,
  isNullableIsoDateString,
  isNullableNonEmptyString,
  isNullableNumber,
  isRecord,
} from "./syncClientValidatorUtils";
import {
  isProductAdvertisingActionSyncStatus,
  isProductAdvertisingBidSyncStatus,
  isProductAdvertisingClusterQueryMappingSource,
  isProductAdvertisingClusterQueryMatchConfidence,
  isProductAdvertisingClusterQuerySource,
  isProductAdvertisingSourceKind,
} from "./syncClientAdvertisingEnumValidatorGuards";

export function isProductClusterLookupMatch(
  value: unknown,
): value is ProductClusterLookupMatch {
  return (
    isRecord(value) &&
    isNonEmptyString(value.queryText) &&
    isNonEmptyString(value.clusterName) &&
    isProductAdvertisingSourceKind(value.sourceKind) &&
    isProductAdvertisingClusterQueryMappingSource(value.mappingSource) &&
    (value.isActive === null || typeof value.isActive === "boolean") &&
    (value.advertId === null || typeof value.advertId === "number") &&
    isNullableNumber(value.views) &&
    isNullableNumber(value.clicks) &&
    isNullableNumber(value.orders) &&
    isNullableNumber(value.addToCart) &&
    isNullableNumber(value.shks) &&
    isNullableIsoDateString(value.updatedAt)
  );
}

export function isProductAdvertisingCampaign(
  value: unknown,
): value is ProductAdvertisingCampaign {
  return (
    isRecord(value) &&
    typeof value.advertId === "number" &&
    typeof value.campaignType === "number" &&
    typeof value.campaignStatus === "number" &&
    isNullableNonEmptyString(value.paymentType) &&
    isNullableNonEmptyString(value.bidType) &&
    isNullableNonEmptyString(value.currency) &&
    isNullableNonEmptyString(value.name) &&
    isNullableNumber(value.subjectId) &&
    isNullableNonEmptyString(value.subjectName) &&
    isNullableIsoDateString(value.changeTime) &&
    isNullableIsoDateString(value.createdAtWb) &&
    isNullableIsoDateString(value.startedAtWb) &&
    isNullableIsoDateString(value.updatedAtWb) &&
    isNullableIsoDateString(value.syncedAt)
  );
}

export function isProductAdvertisingCluster(
  value: unknown,
): value is ProductAdvertisingCluster {
  return (
    isRecord(value) &&
    isNullableNumber(value.advertId) &&
    isNullableNonEmptyString(value.campaignName) &&
    isNullableNumber(value.campaignType) &&
    isNullableNumber(value.campaignStatus) &&
    isNullableNonEmptyString(value.paymentType) &&
    isNullableNonEmptyString(value.bidType) &&
    isNullableNonEmptyString(value.currency) &&
    isNonEmptyString(value.clusterName) &&
    isNonEmptyString(value.canonicalNormQuery) &&
    isProductAdvertisingSourceKind(value.sourceKind) &&
    (value.isActive === null || typeof value.isActive === "boolean") &&
    isNullableNumber(value.views) &&
    isNullableNumber(value.clicks) &&
    isNullableNumber(value.orders) &&
    isNullableNumber(value.addToCart) &&
    isNullableNumber(value.shks) &&
    isNullableNumber(value.ctr) &&
    isNullableNumber(value.avgPosition) &&
    isNullableNumber(value.cpc) &&
    isNullableNumber(value.cpm) &&
    isNullableNumber(value.spend) &&
    isNullableNumber(value.bid) &&
    (value.bidSyncStatus === null ||
      isProductAdvertisingBidSyncStatus(value.bidSyncStatus)) &&
    isNullableIsoDateString(value.bidConfirmedAt) &&
    isNullableIsoDateString(value.bidRetryAt) &&
    isNullableNonEmptyString(value.bidLastError) &&
    (value.actionSyncStatus === null ||
      isProductAdvertisingActionSyncStatus(value.actionSyncStatus)) &&
    isNullableIsoDateString(value.actionRetryAt) &&
    isNullableNonEmptyString(value.actionLastError) &&
    isNullableNumber(value.queryCount) &&
    isNullableNumber(value.jamQueryCount) &&
    isNullableNumber(value.jamFrequency) &&
    isNullableNumber(value.jamClicks) &&
    isNullableNumber(value.jamAddToCart) &&
    isNullableNumber(value.jamOrders) &&
    isNullableNumber(value.jamAvgPosition) &&
    isNullableNumber(value.monthlyFrequency) &&
    isNullableIsoDateString(value.updatedAt)
  );
}

export function isProductAdvertisingClusterQuery(
  value: unknown,
): value is ProductAdvertisingClusterQuery {
  return (
    isRecord(value) &&
    typeof value.advertId === "number" &&
    isNonEmptyString(value.clusterName) &&
    isNonEmptyString(value.queryText) &&
    isProductAdvertisingClusterQuerySource(value.querySource) &&
    isProductAdvertisingClusterQueryMappingSource(value.mappingSource) &&
    isProductAdvertisingClusterQueryMatchConfidence(value.matchConfidence) &&
    typeof value.isFrequencyBacked === "boolean" &&
    typeof value.isClusterConfirmed === "boolean" &&
    typeof value.isCanonicalClusterQuery === "boolean" &&
    typeof value.isCabinetBacked === "boolean" &&
    isNullableIsoDateString(value.cabinetSnapshotAt) &&
    isProductAdvertisingSourceKind(value.sourceKind) &&
    (value.isActive === null || typeof value.isActive === "boolean") &&
    isNullableNumber(value.views) &&
    isNullableNumber(value.clicks) &&
    isNullableNumber(value.orders) &&
    isNullableNumber(value.addToCart) &&
    isNullableNumber(value.shks) &&
    isNullableNumber(value.jamFrequency) &&
    isNullableNumber(value.jamClicks) &&
    isNullableNumber(value.jamAddToCart) &&
    isNullableNumber(value.jamOrders) &&
    isNullableNumber(value.jamAvgPosition) &&
    isNullableNumber(value.jamOpenToCart) &&
    isNullableNumber(value.monthlyFrequency) &&
    isNullableIsoDateString(value.updatedAt)
  );
}

export function isProductAdvertisingDailyStat(
  value: unknown,
): value is ProductAdvertisingDailyStat {
  return (
    isRecord(value) &&
    typeof value.advertId === "number" &&
    isNonEmptyString(value.date) &&
    isNonEmptyString(value.clusterName) &&
    isNullableNumber(value.views) &&
    isNullableNumber(value.clicks) &&
    isNullableNumber(value.orders) &&
    isNullableNumber(value.addToCart) &&
    isNullableNumber(value.shks) &&
    isNullableNumber(value.ctr) &&
    isNullableNumber(value.avgPosition) &&
    isNullableNumber(value.cpc) &&
    isNullableNumber(value.cpm) &&
    isNullableNumber(value.spend) &&
    isNullableNonEmptyString(value.currency) &&
    isNullableIsoDateString(value.updatedAt)
  );
}

export function isProductAdvertisingMinusPhrase(
  value: unknown,
): value is ProductAdvertisingMinusPhrase {
  return (
    isRecord(value) &&
    typeof value.advertId === "number" &&
    isNonEmptyString(value.phrase) &&
    isNullableIsoDateString(value.updatedAt)
  );
}

export function isProductAdvertisingKeywordStat(
  value: unknown,
): value is ProductAdvertisingKeywordStat {
  return (
    isRecord(value) &&
    typeof value.advertId === "number" &&
    isNonEmptyString(value.date) &&
    isNonEmptyString(value.keyword) &&
    isNullableNumber(value.views) &&
    isNullableNumber(value.clicks) &&
    isNullableNumber(value.ctr) &&
    isNullableNumber(value.spend) &&
    isNullableNonEmptyString(value.currency) &&
    isNullableIsoDateString(value.updatedAt)
  );
}
