import type {
  ProductAdvertisingBidSyncStatus,
  ProductAdvertisingSheetResponse,
} from "../../../api/syncClient";

export function clearCachedProductAdvertisingSheets(storageKeyPrefix: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const keysToDelete: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index);
      if (storageKey && storageKey.startsWith(storageKeyPrefix)) {
        keysToDelete.push(storageKey);
      }
    }

    for (const storageKey of keysToDelete) {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    return;
  }
}

// Cluster-identity normalizer. Matches the backend normalizeQuery (trim + lowercase
// + collapse whitespace, punctuation PRESERVED) so the `{advertId}:{name}` keys built
// here line up with the backend normalized_cluster_name column when sent back to the API.
export function normalizeAdvertisingText(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/\s+/g, " ");
}

export function isTransientActionSyncStatus(
  status: ProductAdvertisingSheetResponse["clusters"][number]["actionSyncStatus"],
) {
  return status === "queued" || status === "sending" || status === "throttled";
}

export function mergeProductAdvertisingSheetSnapshots(
  currentValue: ProductAdvertisingSheetResponse | null,
  nextValue: ProductAdvertisingSheetResponse | null,
) {
  if (!nextValue) {
    return currentValue;
  }

  if (!currentValue || currentValue.nmId !== nextValue.nmId) {
    return nextValue;
  }

  if (
    currentValue.range.startDate !== nextValue.range.startDate ||
    currentValue.range.endDate !== nextValue.range.endDate ||
    currentValue.range.jamIncluded !== nextValue.range.jamIncluded ||
    currentValue.range.jamStatus !== nextValue.range.jamStatus
  ) {
    if (
      currentValue.range.startDate === nextValue.range.startDate &&
      currentValue.range.endDate === nextValue.range.endDate &&
      currentValue.range.jamStatus === "ready" &&
      nextValue.range.jamStatus !== "ready"
    ) {
      return currentValue;
    }

    return nextValue;
  }

  if (
    currentValue.range.jamStatus === "ready" &&
    nextValue.range.jamStatus !== "ready"
  ) {
    return currentValue;
  }

  const currentClustersByKey = new Map(
    currentValue.clusters.map((cluster) => [
      `${cluster.advertId ?? "none"}:${normalizeAdvertisingText(cluster.clusterName)}`,
      cluster,
    ]),
  );

  const nextClusters = nextValue.clusters.map((cluster) => {
    const currentCluster =
      currentClustersByKey.get(
        `${cluster.advertId ?? "none"}:${normalizeAdvertisingText(cluster.clusterName)}`,
      ) ?? null;

    if (!currentCluster) {
      return cluster;
    }

    if (
      isTransientBidSyncStatus(currentCluster.bidSyncStatus) &&
      !(
        cluster.bidSyncStatus === "confirmed" &&
        cluster.bid !== null &&
        currentCluster.bid !== null &&
        cluster.bid === currentCluster.bid
      )
    ) {
      return {
        ...cluster,
        canonicalNormQuery: currentCluster.canonicalNormQuery,
        bid: currentCluster.bid,
        bidSyncStatus: pickPreferredBidSyncStatus(
          currentCluster.bidSyncStatus,
          cluster.bidSyncStatus,
        ),
        bidConfirmedAt: currentCluster.bidConfirmedAt,
        bidRetryAt: pickLatestIsoDate(currentCluster.bidRetryAt, cluster.bidRetryAt),
        bidLastError: cluster.bidLastError ?? currentCluster.bidLastError,
        updatedAt: pickLatestIsoDate(cluster.updatedAt, currentCluster.updatedAt),
      };
    }

    if (
      isTransientActionSyncStatus(currentCluster.actionSyncStatus) &&
      !(
        cluster.actionSyncStatus === "confirmed" &&
        cluster.isActive === currentCluster.isActive &&
        cluster.sourceKind === currentCluster.sourceKind
      )
    ) {
      return {
        ...cluster,
        canonicalNormQuery: currentCluster.canonicalNormQuery,
        sourceKind: currentCluster.sourceKind,
        isActive: currentCluster.isActive,
        actionSyncStatus: pickPreferredActionSyncStatus(
          currentCluster.actionSyncStatus,
          cluster.actionSyncStatus,
        ),
        actionRetryAt: pickLatestIsoDate(
          currentCluster.actionRetryAt,
          cluster.actionRetryAt,
        ),
        actionLastError: cluster.actionLastError ?? currentCluster.actionLastError,
        updatedAt: pickLatestIsoDate(cluster.updatedAt, currentCluster.updatedAt),
      };
    }

    return cluster;
  });

  return {
    ...nextValue,
    clusters: nextClusters,
  };
}

function isTransientBidSyncStatus(status: ProductAdvertisingBidSyncStatus | null) {
  return status !== null && status !== "confirmed";
}

function pickPreferredBidSyncStatus(
  currentValue: ProductAdvertisingSheetResponse["clusters"][number]["bidSyncStatus"],
  nextValue: ProductAdvertisingSheetResponse["clusters"][number]["bidSyncStatus"],
) {
  const statusPriority: Record<ProductAdvertisingBidSyncStatus, number> = {
    failed: 6,
    throttled: 5,
    sending: 4,
    queued: 3,
    pending: 2,
    confirmed: 1,
  };

  if (!currentValue) {
    return nextValue;
  }
  if (!nextValue) {
    return currentValue;
  }

  return statusPriority[currentValue] >= statusPriority[nextValue] ? currentValue : nextValue;
}

function pickPreferredActionSyncStatus(
  currentValue: ProductAdvertisingSheetResponse["clusters"][number]["actionSyncStatus"],
  nextValue: ProductAdvertisingSheetResponse["clusters"][number]["actionSyncStatus"],
) {
  const statusPriority: Record<NonNullable<typeof currentValue>, number> = {
    failed: 5,
    throttled: 4,
    sending: 3,
    queued: 2,
    confirmed: 1,
  };

  if (!currentValue) {
    return nextValue;
  }
  if (!nextValue) {
    return currentValue;
  }

  return statusPriority[currentValue] >= statusPriority[nextValue] ? currentValue : nextValue;
}

function pickLatestIsoDate(currentValue: string | null, nextValue: string | null) {
  if (!currentValue) {
    return nextValue;
  }

  if (!nextValue) {
    return currentValue;
  }

  return Date.parse(nextValue) > Date.parse(currentValue) ? nextValue : currentValue;
}
