import type {
  ProductAdvertisingQueryCoverageSummary,
  RawAdvertisingSheetClusterQueryRow,
  RawAdvertisingSheetClusterRow,
} from "./wb-clusters.repository.types";
import type {
  ProductAdvertisingClusterQueryMappingSource,
  ProductAdvertisingClusterQueryMatchConfidence,
  ProductAdvertisingSheetResponse,
} from "./wb-clusters.types";

import { WbClustersRepositoryAdvertisingQueryMatching } from "./wb-clusters.repository.advertising-query-matching";

export abstract class WbClustersRepositoryAdvertisingQueryCoverage extends WbClustersRepositoryAdvertisingQueryMatching {
  protected buildProductAdvertisingQueryCoverageSummary(
    rawClusters: RawAdvertisingSheetClusterRow[],
    authoritativeQueryRows: RawAdvertisingSheetClusterQueryRow[],
    canonicalClusterQueries: ProductAdvertisingSheetResponse["clusterQueries"],
  ): ProductAdvertisingQueryCoverageSummary {
    const advertClusterCount = rawClusters.filter((cluster) => cluster.advertId !== null).length;
    if (advertClusterCount === 0) {
      return {
        clusterQueriesCount: canonicalClusterQueries.length,
        queryCoverageStatus: "no-clusters",
        queryCoverageReason: null,
      };
    }

    if (authoritativeQueryRows.length === 0) {
      return {
        clusterQueriesCount: canonicalClusterQueries.length,
        queryCoverageStatus: "missing-query-map",
        queryCoverageReason:
          "No promotion or cabinet query-map rows were available for this product.",
      };
    }

    if (canonicalClusterQueries.length === 0) {
      return {
        clusterQueriesCount: 0,
        queryCoverageStatus: "missing-query-map",
        queryCoverageReason:
          "Query-map rows exist, but none survived canonical cluster matching. Inspect normalization drift or source mismatch.",
      };
    }

    const canonicalCoverageRatio = canonicalClusterQueries.length / authoritativeQueryRows.length;
    if (canonicalCoverageRatio < 0.25) {
      return {
        clusterQueriesCount: canonicalClusterQueries.length,
        queryCoverageStatus: "partial",
        queryCoverageReason:
          "Only part of the authoritative query map survived canonical cluster matching after normalization and deduplication.",
      };
    }

    return {
      clusterQueriesCount: canonicalClusterQueries.length,
      queryCoverageStatus: "ready",
      queryCoverageReason: null,
    };
  }

  protected buildAdvertisingQueryIdentityKey(
    advertId: number,
    normalizedClusterName: string,
    normalizedQueryText: string,
  ) {
    return `${advertId}:${this.normalizeAdvertisingIdentity(normalizedClusterName)}:${this.normalizeAdvertisingIdentity(normalizedQueryText)}`;
  }

  protected mergeAdvertisingQueryMappingSource(
    left: ProductAdvertisingClusterQueryMappingSource,
    right: ProductAdvertisingClusterQueryMappingSource,
  ): ProductAdvertisingClusterQueryMappingSource {
    if (left === right) {
      return left;
    }

    if (left === "cluster-name" || right === "cluster-name") {
      return left === "cluster-name" ? right : left;
    }

    return "merged";
  }

  protected resolveAdvertisingClusterQueryMatchConfidence(
    isExactClusterQuery: boolean,
    isTrustedSourceBacked: boolean,
    isFrequencyBacked: boolean,
    isStatsBacked: boolean,
    isSoftMatch: boolean,
  ): ProductAdvertisingClusterQueryMatchConfidence {
    if (isExactClusterQuery) {
      return "exact";
    }

    if (isTrustedSourceBacked) {
      return "trusted-source";
    }

    if (isStatsBacked) {
      return "stats-backed";
    }

    if (isFrequencyBacked) {
      return "frequency-backed";
    }

    if (isSoftMatch) {
      return "soft-match";
    }

    return "trusted-source";
  }

}
