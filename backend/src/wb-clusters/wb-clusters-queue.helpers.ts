import { HttpException, HttpStatus } from "@nestjs/common";

export type ClusterBidJobLike = {
  attemptCount: number;
};

export type ClusterActionJobLike = {
  attemptCount: number;
};

export type ClusterBidJobItemLike = {
  clusterName: string;
  normalizedClusterName: string;
  desiredBid: number;
  itemStatus: string;
};

export type ClusterActionJobItemLike = {
  clusterName: string;
  normalizedClusterName: string;
  desiredIsActive: boolean;
  itemStatus: string;
};

export function isActiveClusterBidJobItemStatus(status: string) {
  return status === "queued" || status === "running" || status === "retry_scheduled";
}

export function isActiveClusterActionJobItemStatus(status: string) {
  return status === "queued" || status === "running" || status === "retry_scheduled";
}

export function buildMergedClusterBidList(
  jobs: Array<{
    items: ClusterBidJobItemLike[];
  }>,
) {
  const mergedBids = new Map<
    string,
    {
      clusterName: string;
      bid: number;
    }
  >();

  for (const job of jobs) {
    for (const item of job.items) {
      if (!isActiveClusterBidJobItemStatus(item.itemStatus)) {
        continue;
      }

      mergedBids.set(item.normalizedClusterName, {
        clusterName: item.clusterName,
        bid: item.desiredBid,
      });
    }
  }

  return Array.from(mergedBids.values());
}

export function buildMergedClusterActionList(
  jobs: Array<{
    items: ClusterActionJobItemLike[];
  }>,
) {
  const mergedActions = new Map<
    string,
    {
      clusterName: string;
      normalizedClusterName: string;
      desiredIsActive: boolean;
    }
  >();

  for (const job of jobs) {
    for (const item of job.items) {
      if (!isActiveClusterActionJobItemStatus(item.itemStatus)) {
        continue;
      }

      mergedActions.set(item.normalizedClusterName, {
        clusterName: item.clusterName,
        normalizedClusterName: item.normalizedClusterName,
        desiredIsActive: item.desiredIsActive,
      });
    }
  }

  return Array.from(mergedActions.values());
}

export function getClusterBidJobRetryDelayMs(
  jobs: ClusterBidJobLike[],
  serverSuggestedDelayMs?: number | null,
) {
  const maxAttemptCount = Math.max(...jobs.map((job) => job.attemptCount), 1);
  const fallbackDelayMs =
    maxAttemptCount <= 1 ? 5_000 : maxAttemptCount === 2 ? 10_000 : maxAttemptCount === 3 ? 20_000 : 30_000;
  return Math.max(fallbackDelayMs, serverSuggestedDelayMs ?? 0);
}

export function getClusterBidReadbackRetryDelayMs(
  jobCount: number,
  serverSuggestedDelayMs?: number | null,
) {
  const fallbackDelayMs = jobCount <= 1 ? 5_000 : jobCount <= 3 ? 8_000 : 12_000;
  return Math.max(fallbackDelayMs, serverSuggestedDelayMs ?? 0);
}

export function getClusterActionJobRetryDelayMs(
  jobs: ClusterActionJobLike[],
  serverSuggestedDelayMs?: number | null,
) {
  const maxAttemptCount = Math.max(...jobs.map((job) => job.attemptCount), 1);
  const fallbackDelayMs =
    maxAttemptCount <= 1 ? 5_000 : maxAttemptCount === 2 ? 10_000 : maxAttemptCount === 3 ? 20_000 : 30_000;
  return Math.max(fallbackDelayMs, serverSuggestedDelayMs ?? 0);
}

export function getPromotionRetryDelayMs(error: unknown) {
  if (!(error instanceof HttpException)) {
    return null;
  }

  const response = error.getResponse();
  if (!response || typeof response !== "object" || !("responseMeta" in response)) {
    return null;
  }

  const responseMeta = response.responseMeta;
  if (!responseMeta || typeof responseMeta !== "object") {
    return null;
  }

  const rateLimitRetry =
    "rateLimitRetry" in responseMeta && typeof responseMeta.rateLimitRetry === "number"
      ? responseMeta.rateLimitRetry
      : null;
  const rateLimitReset =
    "rateLimitReset" in responseMeta && typeof responseMeta.rateLimitReset === "number"
      ? responseMeta.rateLimitReset
      : null;
  const retrySeconds =
    rateLimitRetry !== null && rateLimitRetry > 0
      ? rateLimitRetry
      : rateLimitReset !== null && rateLimitReset > 0
        ? rateLimitReset
        : null;

  return retrySeconds !== null ? retrySeconds * 1000 : null;
}

export function hasExceededClusterBidJobAttempts(
  jobs: ClusterBidJobLike[],
  maxClusterBidJobAttempts: number,
) {
  return Math.max(...jobs.map((job) => job.attemptCount), 1) >= maxClusterBidJobAttempts;
}

export function hasExceededClusterActionJobAttempts(
  jobs: ClusterActionJobLike[],
  maxClusterActionJobAttempts: number,
) {
  return Math.max(...jobs.map((job) => job.attemptCount), 1) >= maxClusterActionJobAttempts;
}

export function getRecoverableBidSyncStatus(error: unknown) {
  if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
    return "throttled" as const;
  }

  return "pending" as const;
}

export function getRecoverableActionSyncStatus(error: unknown) {
  return getPromotionRetryDelayMs(error) !== null ? "throttled" : "queued";
}

export function normalizeBidForWb(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizeBidFromWb(value: number) {
  return Math.round(value * 100) / 100;
}
