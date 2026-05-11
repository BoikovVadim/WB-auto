import { createEmptyProductAdvertisingSheetResponse } from "./product-advertising-sheet.response";
import {
  normalizeCampaign,
  normalizeCluster,
  normalizeClusterQuery,
  normalizeDailyStat,
  normalizeKeywordStat,
  normalizeMinusPhrase,
} from "./product-advertising-sheet.contract.item-normalizers";
import {
  normalizeRange,
  normalizeSnapshot,
  normalizeSummary,
} from "./product-advertising-sheet.contract.meta-normalizers";
import {
  type NormalizationResult,
  type RootCounts,
  asIsoDateTime,
  isRecord,
  normalizeArray,
  trackRepair,
} from "./product-advertising-sheet.contract.shared";
import type { ProductAdvertisingSheetResponse } from "./types/product-advertising-sheet.types";

export function normalizeProductAdvertisingSheetResponse(
  value: unknown,
): NormalizationResult<ProductAdvertisingSheetResponse> {
  if (!isRecord(value) || typeof value.nmId !== "number") {
    return {
      value: null,
      issue: "Root snapshot payload is missing a valid nmId.",
      repaired: false,
    };
  }

  const issues: string[] = [];
  const campaigns = normalizeArray(value.campaigns, "campaigns", issues, normalizeCampaign);
  const clusters = normalizeArray(value.clusters, "clusters", issues, normalizeCluster);
  const clusterQueries = normalizeArray(
    value.clusterQueries,
    "clusterQueries",
    issues,
    normalizeClusterQuery,
  );
  const dailyStats = normalizeArray(value.dailyStats, "dailyStats", issues, normalizeDailyStat);
  const minusPhrases = normalizeArray(
    value.minusPhrases,
    "minusPhrases",
    issues,
    normalizeMinusPhrase,
  );
  const keywordStats = normalizeArray(
    value.keywordStats,
    "keywordStats",
    issues,
    normalizeKeywordStat,
  );

  const counts: RootCounts = {
    campaignsCount: campaigns.length,
    clustersCount: clusters.length,
    clusterQueriesCount: clusterQueries.length,
    dailyStatsCount: dailyStats.length,
    minusPhrasesCount: minusPhrases.length,
    keywordStatsCount: keywordStats.length,
  };

  const normalizedValue: ProductAdvertisingSheetResponse = {
    nmId: value.nmId,
    checkedAt: asIsoDateTime(value.checkedAt) ?? trackRepair(issues, "checkedAt", new Date().toISOString()),
    snapshot: normalizeSnapshot(value.snapshot, issues),
    range: normalizeRange(value.range, issues),
    summary: normalizeSummary(value.summary, counts, clusters.length, clusterQueries.length, issues),
    campaigns,
    clusters,
    clusterQueries,
    dailyStats,
    minusPhrases,
    keywordStats,
  };

  return {
    value: normalizedValue,
    issue: issues[0] ?? null,
    repaired: issues.length > 0,
  };
}

export function buildIncompatibleProductAdvertisingSheetResponse(input: {
  nmId: number;
  requestedStartDate?: string | null;
  requestedEndDate?: string | null;
  issue?: string | null;
}) {
  return createEmptyProductAdvertisingSheetResponse({
    nmId: input.nmId,
    requestedStartDate: input.requestedStartDate ?? null,
    requestedEndDate: input.requestedEndDate ?? null,
    snapshotStatus: "failed",
    snapshotFit: "unavailable",
    snapshotSource: "snapshot_store",
    lastError:
      input.issue ??
      "Stored product advertising snapshot is incompatible with the current runtime contract.",
  });
}
