import type { PromotionThrottleLane } from "./wb-clusters.types";

export const PROMOTION_THROTTLE_LANES = [
  "bid-write",
  "minus-write",
  "bid-read",
  "minus-read",
  "details",
  "stats",
  "default",
] as const satisfies readonly PromotionThrottleLane[];

export interface PromotionRequestConfig {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface PromotionRequestOptions {
  failFastOnTooManyRequests?: boolean;
  maxQueueWaitMs?: number;
}

export interface PromotionThrottleState {
  nextAllowedRequestAtMs: number;
  requestThrottleQueue: Promise<void>;
  pendingRequests: number;
}

export interface PromotionLaneTelemetry {
  requestsStarted: number;
  requestsCompleted: number;
  requestsFailed: number;
  retryCount: number;
  tooManyRequestsCount: number;
  totalWaitMs: number;
  totalDurationMs: number;
  lastWaitMs: number | null;
  lastDurationMs: number | null;
  lastPath: string | null;
  lastErrorStatusCode: number | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
}

export interface PromotionResponseMeta {
  requestId: string | null;
  rateLimitRetry: number | null;
  rateLimitLimit: number | null;
  rateLimitReset: number | null;
  localCooldown?: boolean;
}
