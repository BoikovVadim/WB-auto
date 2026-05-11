import type {
  PromotionLaneTelemetry,
  PromotionThrottleState,
} from "./wb-promotion-api.client.shared";
import { PROMOTION_THROTTLE_LANES } from "./wb-promotion-api.client.shared";
import { getPromotionLaneCooldownRemainingMs } from "./wb-promotion-api.client.throttle";
import { toIsoTimestamp } from "./wb-promotion-api.client.timing";
import type { PromotionThrottleLane } from "./wb-clusters.types";

export function createPromotionLaneTelemetryMap(): Record<
  PromotionThrottleLane,
  PromotionLaneTelemetry
> {
  return Object.fromEntries(
    PROMOTION_THROTTLE_LANES.map((lane) => [lane, createEmptyPromotionLaneTelemetry()]),
  ) as Record<PromotionThrottleLane, PromotionLaneTelemetry>;
}

export function createEmptyPromotionLaneTelemetry(): PromotionLaneTelemetry {
  return {
    requestsStarted: 0,
    requestsCompleted: 0,
    requestsFailed: 0,
    retryCount: 0,
    tooManyRequestsCount: 0,
    totalWaitMs: 0,
    totalDurationMs: 0,
    lastWaitMs: null,
    lastDurationMs: null,
    lastPath: null,
    lastErrorStatusCode: null,
    lastStartedAt: null,
    lastFinishedAt: null,
  };
}

export function recordPromotionRequestStart(
  telemetry: PromotionLaneTelemetry,
  path: string,
  waitMs: number,
) {
  telemetry.requestsStarted += 1;
  telemetry.totalWaitMs += waitMs;
  telemetry.lastWaitMs = waitMs;
  telemetry.lastPath = path;
  telemetry.lastStartedAt = toIsoTimestamp();
}

export function recordPromotionRequestSuccess(
  telemetry: PromotionLaneTelemetry,
  durationMs: number,
) {
  telemetry.requestsCompleted += 1;
  telemetry.totalDurationMs += durationMs;
  telemetry.lastDurationMs = durationMs;
  telemetry.lastErrorStatusCode = null;
  telemetry.lastFinishedAt = toIsoTimestamp();
}

export function recordPromotionRequestFailure(
  telemetry: PromotionLaneTelemetry,
  statusCode: number | null,
  wasRetry: boolean,
  wasTooManyRequests: boolean,
) {
  if (wasRetry) {
    telemetry.retryCount += 1;
  }
  telemetry.requestsFailed += 1;
  telemetry.lastErrorStatusCode = statusCode;
  telemetry.lastFinishedAt = toIsoTimestamp();
  if (wasTooManyRequests) {
    telemetry.tooManyRequestsCount += 1;
  }
}

export function buildPromotionLaneTelemetrySnapshot(
  throttleStates: Record<PromotionThrottleLane, PromotionThrottleState>,
  laneTelemetry: Record<PromotionThrottleLane, PromotionLaneTelemetry>,
  lane: PromotionThrottleLane,
) {
  const telemetry = laneTelemetry[lane];
  const completedRequests = telemetry.requestsCompleted;
  return {
    pendingRequests: throttleStates[lane].pendingRequests,
    cooldownRemainingMs: getPromotionLaneCooldownRemainingMs(throttleStates, lane),
    requestsStarted: telemetry.requestsStarted,
    requestsCompleted: telemetry.requestsCompleted,
    requestsFailed: telemetry.requestsFailed,
    retryCount: telemetry.retryCount,
    tooManyRequestsCount: telemetry.tooManyRequestsCount,
    avgWaitMs:
      telemetry.requestsStarted > 0 ? telemetry.totalWaitMs / telemetry.requestsStarted : null,
    avgDurationMs:
      completedRequests > 0 ? telemetry.totalDurationMs / completedRequests : null,
    lastWaitMs: telemetry.lastWaitMs,
    lastDurationMs: telemetry.lastDurationMs,
    lastPath: telemetry.lastPath,
    lastErrorStatusCode: telemetry.lastErrorStatusCode,
    lastStartedAt: telemetry.lastStartedAt,
    lastFinishedAt: telemetry.lastFinishedAt,
  };
}
