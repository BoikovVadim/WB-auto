import type {
  CanonicalClusterDescriptor,
  RawAdvertisingSheetClusterQueryRow,
} from "./wb-clusters.repository.types";
import type {
  ProductAdvertisingClusterQuerySource,
  ProductAdvertisingSheetResponse,
} from "./wb-clusters.types";

import { WbClustersRepositoryAdvertisingQueryPriority } from "./wb-clusters.repository.advertising-query-priority";

export abstract class WbClustersRepositoryAdvertisingQueryMatching extends WbClustersRepositoryAdvertisingQueryPriority {
  protected pickBestClusterDescriptor(
    descriptors: CanonicalClusterDescriptor[],
    queryTokenStems: string[],
    queryTokenStemSet?: Set<string>,
  ) {
    let bestDescriptor: CanonicalClusterDescriptor | null = null;
    let bestScore = 0;
    // Build the Set once for all descriptors if not provided by the caller.
    const qSet = queryTokenStemSet ?? new Set(queryTokenStems);

    for (const descriptor of descriptors) {
      const score = this.scoreClusterDescriptorMatch(descriptor, queryTokenStems, qSet);
      if (score > bestScore) {
        bestScore = score;
        bestDescriptor = descriptor;
      }
    }

    return bestScore > 0 ? bestDescriptor : null;
  }

  protected scoreClusterDescriptorMatch(
    descriptor: CanonicalClusterDescriptor,
    queryTokenStems: string[],
    queryTokenSet?: Set<string>,
  ) {
    if (descriptor.tokenStems.length === 0 || queryTokenStems.length === 0) {
      return 0;
    }

    // Use pre-computed sets when available — avoids 140 M Set allocations for
    // large cabinet-query datasets (190 k queries × 184 descriptors × 2 calls).
    const cTokenSet = descriptor.tokenStemSet ?? new Set(descriptor.tokenStems);
    const qTokenSet = queryTokenSet ?? new Set(queryTokenStems);

    const matchedCount = descriptor.tokenStems.reduce(
      (n, token) => n + (qTokenSet.has(token) ? 1 : 0),
      0,
    );

    if (matchedCount === 0) {
      return 0;
    }

    if (descriptor.tokenStems.length === 1) {
      const clusterToken = descriptor.tokenStems[0];
      if (!qTokenSet.has(clusterToken)) {
        return 0;
      }

      // Count extra tokens in query not covered by the single cluster token.
      let extraCount = 0;
      let hasLatinExtra = false;
      for (const token of qTokenSet) {
        if (token !== clusterToken) {
          extraCount++;
          if (/[a-z0-9]/i.test(token)) hasLatinExtra = true;
        }
      }

      if (extraCount === 0) {
        return descriptor.hasLatinOrDigitToken ? 90 : 80;
      }

      if (hasLatinExtra && !descriptor.hasLatinOrDigitToken) {
        return 0;
      }

      if (extraCount > 2) {
        return 0;
      }

      return descriptor.hasLatinOrDigitToken ? 45 - extraCount : 35 - extraCount;
    }

    const allClusterTokensMatched = descriptor.tokenStems.every((token) =>
      qTokenSet.has(token),
    );
    if (!allClusterTokensMatched) {
      return 0;
    }

    return 100 + matchedCount - Math.max(0, qTokenSet.size - cTokenSet.size);
  }

  protected isLexicallyAlignedClusterQuery(
    descriptor: CanonicalClusterDescriptor,
    queryTokenStems: string[],
    rawQueryTokenStems: string[],
    advertVocabulary: Set<string>,
    queryTokenStemSet?: Set<string>,
  ) {
    if (descriptor.tokenStems.length === 0 || queryTokenStems.length === 0) {
      return false;
    }

    if (descriptor.tokenStems.length === 1) {
      // Avoid Array.from(new Set(...)) — de-duplicate inline.
      const seen = new Set(rawQueryTokenStems);
      const distinct = Array.from(seen);
      return (
        distinct.length === 1 &&
        distinct[0] === descriptor.tokenStems[0]
      );
    }

    const qTokenSet = queryTokenStemSet ?? new Set(queryTokenStems);
    const cTokenSet = descriptor.tokenStemSet ?? new Set(descriptor.tokenStems);

    const allClusterTokensMatched = descriptor.tokenStems.every((token) =>
      qTokenSet.has(token),
    );
    if (!allClusterTokensMatched) {
      return false;
    }

    // Count and check extra tokens without creating an intermediate array.
    let extraCount = 0;
    let hasLatinExtra = false;
    for (const token of qTokenSet) {
      if (!cTokenSet.has(token)) {
        extraCount++;
        if (/[a-z0-9]/i.test(token)) hasLatinExtra = true;
      }
    }

    if (hasLatinExtra && !descriptor.hasLatinOrDigitToken) {
      return false;
    }

    const allowedExtraTokens = descriptor.tokenStems.length === 1 ? 2 : 3;
    if (extraCount > allowedExtraTokens) {
      return false;
    }

    if (extraCount === 0) {
      return true;
    }

    // Check extra tokens against advertVocabulary using the Set directly.
    for (const token of qTokenSet) {
      if (!cTokenSet.has(token) && !advertVocabulary.has(token)) {
        return false;
      }
    }
    return true;
  }

  protected extractRawAdvertisingTokenStems(value: string) {
    return value
      .replace(/ё/g, "е")
      .split(/[^0-9a-zа-я]+/iu)
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
      .map((token) => this.stemAdvertisingToken(token));
  }

  protected resolveAdvertisingClusterQuerySource(
    query: RawAdvertisingSheetClusterQueryRow,
    isExactClusterQuery: boolean,
    isFrequencyBacked: boolean,
    isStatsBacked: boolean,
    isSoftMatch: boolean,
  ): ProductAdvertisingClusterQuerySource {
    if (query.isCabinetBacked) {
      return "cabinet-private-api";
    }

    if (isStatsBacked) {
      return "stats";
    }

    if (isExactClusterQuery && !isFrequencyBacked) {
      return "cluster-name";
    }

    if (isSoftMatch) {
      return "soft-match";
    }

    return "frequency-backed";
  }

  protected isAggregateSafeAdvertisingClusterQuery(
    query: ProductAdvertisingSheetResponse["clusterQueries"][number],
  ) {
    if (query.querySource === "soft-match") {
      return false;
    }

    if (
      query.querySource === "cabinet-private-api" ||
      query.querySource === "stats" ||
      query.querySource === "cluster-name"
    ) {
      return true;
    }

    const clusterTokenStems = this.extractTokenStems(
      this.normalizeAdvertisingIdentity(query.clusterName),
    );
    if (clusterTokenStems.length <= 1) {
      const queryTokenStems = this.extractTokenStems(
        this.normalizeAdvertisingIdentity(query.queryText),
      );
      return queryTokenStems.length === 1 && queryTokenStems[0] === clusterTokenStems[0];
    }

    return true;
  }

  protected extractTokenStems(value: string) {
    return value
      .replace(/ё/g, "е")
      .split(/[^0-9a-zа-я]+/iu)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !this.isAdvertisingStopword(token))
      .map((token) => this.stemAdvertisingToken(token));
  }

  protected isAdvertisingStopword(token: string) {
    return (
      token === "для" ||
      token === "без" ||
      token === "под" ||
      token === "над" ||
      token === "или" ||
      token === "the" ||
      token === "and" ||
      token === "with" ||
      token === "что" ||
      token === "это" ||
      token === "как" ||
      token === "из" ||
      token === "на" ||
      token === "по" ||
      token === "за" ||
      token === "от" ||
      token === "до" ||
      token === "в" ||
      token === "во" ||
      token === "к" ||
      token === "ко" ||
      token === "у" ||
      token === "с" ||
      token === "со" ||
      token === "и"
    );
  }

  protected stemAdvertisingToken(token: string) {
    if (token.length <= 4) {
      return token;
    }

    return token.replace(/[аеёиоуыэюяьй]+$/iu, "");
  }

}
