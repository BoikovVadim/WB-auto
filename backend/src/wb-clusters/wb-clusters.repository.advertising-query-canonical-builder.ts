import type {
  CanonicalClusterDescriptor,
  RawAdvertisingSheetClusterQueryRow,
  RawAdvertisingSheetClusterRow,
} from "./wb-clusters.repository.types";
import type {
  ProductAdvertisingSheetResponse,
} from "./wb-clusters.types";

import { WbClustersRepositoryAdvertisingQueryRowMerging } from "./wb-clusters.repository.advertising-query-row-merging";

// Pre-created collator is ~10× faster than per-call localeCompare("ru").
const ruCollator = new Intl.Collator("ru", { sensitivity: "base" });

export abstract class WbClustersRepositoryAdvertisingQueryCanonicalBuilder extends WbClustersRepositoryAdvertisingQueryRowMerging {
  // Async version with event-loop yields every BATCH_SIZE rows so requests
  // for OTHER products are not blocked while processing large query sets
  // (e.g., 190 k cabinet-query rows for a product with 8 campaigns).
  protected async buildCanonicalAdvertisingClusterQueries(
    rawClusters: RawAdvertisingSheetClusterRow[],
    rawQueries: RawAdvertisingSheetClusterQueryRow[],
  ): Promise<ProductAdvertisingSheetResponse["clusterQueries"]> {
    const BATCH_SIZE = 2_000;

    const descriptorsByAdvertId = new Map<number, CanonicalClusterDescriptor[]>();

    for (const cluster of rawClusters) {
      if (cluster.advertId === null) {
        continue;
      }

      const descriptors = descriptorsByAdvertId.get(cluster.advertId) ?? [];
      if (
        descriptors.some(
          (item) => item.normalizedClusterName === cluster.normalizedClusterName,
        )
      ) {
        descriptorsByAdvertId.set(cluster.advertId, descriptors);
        continue;
      }

      const normalizedIdentity = this.normalizeAdvertisingIdentity(
        cluster.normalizedClusterName,
      );
      const tokenStems = this.extractTokenStems(normalizedIdentity);
      descriptors.push({
        advertId: cluster.advertId,
        clusterName: cluster.clusterName,
        normalizedClusterName: cluster.normalizedClusterName,
        normalizedIdentity,
        tokenStems,
        tokenStemSet: new Set(tokenStems),
        hasLatinOrDigitToken: tokenStems.some((token) => /[a-z0-9]/i.test(token)),
      });
      descriptorsByAdvertId.set(cluster.advertId, descriptors);
    }

    // Pre-compute per-advertId derived structures once — not inside the query loop.
    // advertVocabulary and descriptorByIdentity are the same for all queries of
    // the same campaign, so recomputing them per query was O(queries * clusters).
    const advertVocabularyByAdvertId = new Map<number, Set<string>>();
    const descriptorByIdentityByAdvertId = new Map<number, Map<string, CanonicalClusterDescriptor>>();
    for (const [advertId, descriptors] of descriptorsByAdvertId) {
      advertVocabularyByAdvertId.set(
        advertId,
        new Set(descriptors.flatMap((d) => d.tokenStems)),
      );
      descriptorByIdentityByAdvertId.set(
        advertId,
        new Map(descriptors.map((d) => [d.normalizedIdentity, d])),
      );
    }

    const canonicalQueries: ProductAdvertisingSheetResponse["clusterQueries"] = [];
    const seenCanonicalRows = new Set<string>();

    // Per-call memoization caches. The same cluster names appear for many queries
    // so caching avoids redundant regex operations (normalizeAdvertisingIdentity,
    // extractTokenStems). For 190 k queries with ~1475 unique cluster names this
    // cuts 95%+ of those calls.
    const normalizeCache = new Map<string, string>();
    const memoNormalize = (value: string): string => {
      let result = normalizeCache.get(value);
      if (result === undefined) {
        result = this.normalizeAdvertisingIdentity(value);
        normalizeCache.set(value, result);
      }
      return result;
    };

    const tokenStemsCache = new Map<string, string[]>();
    const memoTokenStems = (normalized: string): string[] => {
      let result = tokenStemsCache.get(normalized);
      if (result === undefined) {
        result = this.extractTokenStems(normalized);
        tokenStemsCache.set(normalized, result);
      }
      return result;
    };

    const tokenStemSetCache = new Map<string, Set<string>>();
    const memoTokenStemSet = (normalized: string): Set<string> => {
      let result = tokenStemSetCache.get(normalized);
      if (result === undefined) {
        result = new Set(memoTokenStems(normalized));
        tokenStemSetCache.set(normalized, result);
      }
      return result;
    };

    const rawTokenStemsCache = new Map<string, string[]>();
    const memoRawTokenStems = (normalized: string): string[] => {
      let result = rawTokenStemsCache.get(normalized);
      if (result === undefined) {
        result = this.extractRawAdvertisingTokenStems(normalized);
        rawTokenStemsCache.set(normalized, result);
      }
      return result;
    };

    for (let i = 0; i < rawQueries.length; i++) {
      // Yield every BATCH_SIZE rows so the event loop stays responsive.
      if (i > 0 && i % BATCH_SIZE === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      const query = rawQueries[i];
      const descriptors = descriptorsByAdvertId.get(query.advertId) ?? [];
      const queryClusterIdentity = memoNormalize(query.normalizedClusterName);
      const assignedDescriptor =
        (descriptorByIdentityByAdvertId.get(query.advertId)?.get(queryClusterIdentity)) ?? null;
      const clusterIdentityTokenStems = memoTokenStems(queryClusterIdentity);
      const clusterIdentityTokenStemSet = memoTokenStemSet(queryClusterIdentity);
      const bestClusterIdentityMatch = this.pickBestClusterDescriptor(
        descriptors,
        clusterIdentityTokenStems,
        clusterIdentityTokenStemSet,
      );
      const normalizedQueryIdentity = memoNormalize(query.normalizedQueryText);
      const queryTokenStems = memoTokenStems(normalizedQueryIdentity);
      const queryTokenStemSet = memoTokenStemSet(normalizedQueryIdentity);
      const rawQueryTokenStems = memoRawTokenStems(normalizedQueryIdentity);
      const advertVocabulary = advertVocabularyByAdvertId.get(query.advertId) ?? new Set<string>();
      const isExactClusterQuery =
        queryClusterIdentity === normalizedQueryIdentity;
      const bestQueryTextMatch = this.pickBestClusterDescriptor(descriptors, queryTokenStems, queryTokenStemSet);
      const preferredDescriptor =
        assignedDescriptor ??
        bestClusterIdentityMatch ??
        (query.mappingSource === "cabinet" || query.mappingSource === "merged"
          ? bestQueryTextMatch
          : null);
      const resolvedClusterIdentity = preferredDescriptor?.normalizedIdentity ?? queryClusterIdentity;
      const resolvedClusterName = preferredDescriptor?.clusterName ?? query.clusterName;
      const isFrequencyBacked = query.monthlyFrequency !== null;
      const isStatsBacked =
        query.views !== null ||
        query.clicks !== null ||
        query.orders !== null ||
        query.addToCart !== null;
      const isClusterConfirmed = preferredDescriptor !== null;
      const matchesAssignedBestDescriptor =
        isClusterConfirmed &&
        bestQueryTextMatch !== null &&
        bestQueryTextMatch.normalizedIdentity === resolvedClusterIdentity;
      const isSoftMatch =
        !query.isCabinetBacked &&
        !isExactClusterQuery &&
        !isFrequencyBacked &&
        !isStatsBacked &&
        matchesAssignedBestDescriptor &&
        preferredDescriptor !== null &&
        this.isLexicallyAlignedClusterQuery(
          preferredDescriptor,
          queryTokenStems,
          rawQueryTokenStems,
          advertVocabulary,
          queryTokenStemSet,
        );
      const isTrustedSourceBacked =
        isClusterConfirmed &&
        (query.mappingSource === "cabinet" || query.mappingSource === "merged");
      const isPromotionBackedByConfirmedMetrics =
        isClusterConfirmed &&
        query.mappingSource === "promotion" &&
        (isFrequencyBacked || isStatsBacked);

      const shouldKeep =
        isTrustedSourceBacked ||
        (isExactClusterQuery && isClusterConfirmed) ||
        isPromotionBackedByConfirmedMetrics ||
        (matchesAssignedBestDescriptor && (isFrequencyBacked || isStatsBacked || isSoftMatch));

      if (!shouldKeep) {
        continue;
      }

      const key = `${query.advertId}:${resolvedClusterIdentity}:${normalizedQueryIdentity}`;
      if (seenCanonicalRows.has(key)) {
        continue;
      }
      seenCanonicalRows.add(key);

      canonicalQueries.push({
        advertId: query.advertId,
        clusterName: resolvedClusterName,
        queryText: query.queryText,
        querySource: this.resolveAdvertisingClusterQuerySource(
          query,
          isExactClusterQuery,
          isFrequencyBacked,
          isStatsBacked,
          isSoftMatch,
        ),
        mappingSource: query.mappingSource,
        matchConfidence: this.resolveAdvertisingClusterQueryMatchConfidence(
          isExactClusterQuery,
          isTrustedSourceBacked,
          isFrequencyBacked,
          isStatsBacked,
          isSoftMatch,
        ),
        isFrequencyBacked,
        isClusterConfirmed,
        isCanonicalClusterQuery: true,
        isCabinetBacked: query.isCabinetBacked,
        cabinetSnapshotAt: query.cabinetSnapshotAt,
        sourceKind: query.sourceKind,
        isActive: query.isActive,
        views: query.views,
        clicks: query.clicks,
        orders: query.orders,
        addToCart: query.addToCart,
        shks: query.shks,
        jamFrequency: null,
        jamClicks: null,
        jamAddToCart: null,
        jamOrders: null,
        jamAvgPosition: null,
        jamOpenToCart: null,
        monthlyFrequency: query.monthlyFrequency,
        updatedAt: query.updatedAt,
      });
    }

    // Use pre-created Intl.Collator — ~10× faster than per-call localeCompare("ru").
    canonicalQueries.sort((left, right) => {
      if (left.advertId !== right.advertId) {
        return left.advertId - right.advertId;
      }

      const clusterComparison = ruCollator.compare(left.clusterName, right.clusterName);
      if (clusterComparison !== 0) {
        return clusterComparison;
      }

      return ruCollator.compare(left.queryText, right.queryText);
    });

    return canonicalQueries;
  }

}
