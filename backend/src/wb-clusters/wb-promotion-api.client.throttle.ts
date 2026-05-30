import { HttpException, HttpStatus, ServiceUnavailableException } from "@nestjs/common";

import { appEnv } from "../common/env";
import type {
  PromotionRequestOptions,
  PromotionThrottleState,
} from "./wb-promotion-api.client.shared";
import { PROMOTION_THROTTLE_LANES } from "./wb-promotion-api.client.shared";
import {
  extendCooldownTarget,
  getRemainingDelayMs,
} from "./wb-promotion-api.client.timing";
import type { PromotionThrottleLane } from "./wb-clusters.types";

export function createPromotionThrottleStates(): Record<PromotionThrottleLane, PromotionThrottleState> {
  return Object.fromEntries(
    PROMOTION_THROTTLE_LANES.map((lane) => [
      lane,
      {
        nextAllowedRequestAtMs: 0,
        requestThrottleQueue: Promise.resolve(),
        pendingRequests: 0,
      } satisfies PromotionThrottleState,
    ]),
  ) as Record<PromotionThrottleLane, PromotionThrottleState>;
}

export function getPromotionMinIntervalMs(path: string) {
  if (path === "/adv/v0/normquery/bids") return appEnv.wbPromotionBidWriteMinIntervalMs;
  if (path === "/adv/v0/normquery/set-minus") return appEnv.wbPromotionMinusWriteMinIntervalMs;
  if (path === "/adv/v0/normquery/get-bids") return appEnv.wbPromotionBidReadMinIntervalMs;
  if (path === "/adv/v0/normquery/get-minus") return appEnv.wbPromotionMinusReadMinIntervalMs;
  if (path === "/api/advert/v2/adverts") return appEnv.wbPromotionDetailsMinIntervalMs;
  if (path === "/adv/v0/normquery/stats" || path === "/adv/v1/normquery/stats") {
    return appEnv.wbPromotionStatsMinIntervalMs;
  }
  if (path === "/adv/v3/fullstats") return appEnv.wbPromotionFullstatsMinIntervalMs;
  return appEnv.wbPromotionApiMinIntervalMs;
}

export function getPromotionThrottleLane(path: string): PromotionThrottleLane {
  if (path === "/adv/v0/normquery/bids") return "bid-write";
  if (path === "/adv/v0/normquery/set-minus") return "minus-write";
  if (path === "/adv/v0/normquery/get-bids") return "bid-read";
  if (path === "/adv/v0/normquery/get-minus") return "minus-read";
  if (path === "/api/advert/v2/adverts") return "details";
  if (path === "/adv/v0/normquery/stats" || path === "/adv/v1/normquery/stats") return "stats";
  if (path === "/adv/v3/fullstats") return "fullstats";
  return "default";
}

export async function enqueuePromotionThrottle(
  throttleState: PromotionThrottleState,
): Promise<() => void> {
  const previous = throttleState.requestThrottleQueue;
  throttleState.pendingRequests += 1;
  let releaseQueue!: () => void;
  throttleState.requestThrottleQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previous;
  return () => {
    throttleState.pendingRequests = Math.max(0, throttleState.pendingRequests - 1);
    releaseQueue();
  };
}

export async function waitForPromotionRequestSlot(args: {
  path: string;
  lane: PromotionThrottleLane;
  throttleStates: Record<PromotionThrottleLane, PromotionThrottleState>;
  backgroundSuppressionRemainingMs: number;
  options?: Pick<PromotionRequestOptions, "maxQueueWaitMs">;
  sleep: (delayMs: number) => Promise<unknown>;
}) {
  const releaseQueue = await enqueuePromotionThrottle(args.throttleStates[args.lane]);
  try {
    const throttleState = args.throttleStates[args.lane];
    const waitMs = Math.max(
      getRemainingDelayMs(throttleState.nextAllowedRequestAtMs),
      getPromotionBackgroundSuppressionWaitMs(args.lane, args.backgroundSuppressionRemainingMs),
    );
    if (typeof args.options?.maxQueueWaitMs === "number" && waitMs > args.options.maxQueueWaitMs) {
      if (isPromotionWriteLane(args.lane)) {
        const retrySeconds = Math.ceil(waitMs / 1000);
        throw new HttpException(
          {
            message:
              "WB write cooldown is active. Latest change is saved locally and will be retried after cooldown.",
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            responseMeta: {
              requestId: null,
              rateLimitRetry: retrySeconds,
              rateLimitReset: retrySeconds,
              localCooldown: true,
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new ServiceUnavailableException(
        "WB Promotion API временно занят. Попробуйте изменить ставку еще раз через несколько секунд.",
      );
    }
    if (waitMs > 0) {
      await args.sleep(waitMs);
    }
    throttleState.nextAllowedRequestAtMs = Date.now() + getPromotionMinIntervalMs(args.path);
    return waitMs;
  } finally {
    releaseQueue();
  }
}

export function extendPromotionLaneCooldown(
  throttleStates: Record<PromotionThrottleLane, PromotionThrottleState>,
  lane: PromotionThrottleLane,
  delayMs: number,
) {
  throttleStates[lane].nextAllowedRequestAtMs = extendCooldownTarget(
    throttleStates[lane].nextAllowedRequestAtMs,
    delayMs,
  );
}

export function getPromotionLaneCooldownRemainingMs(
  throttleStates: Record<PromotionThrottleLane, PromotionThrottleState>,
  lane: PromotionThrottleLane,
) {
  return getRemainingDelayMs(throttleStates[lane].nextAllowedRequestAtMs);
}

export function getPromotionBackgroundSuppressionWaitMs(
  lane: PromotionThrottleLane,
  backgroundSuppressionRemainingMs: number,
) {
  if (isPromotionWriteLane(lane)) {
    return 0;
  }
  return backgroundSuppressionRemainingMs;
}

export function isPromotionWriteLane(lane: PromotionThrottleLane) {
  return lane === "bid-write" || lane === "minus-write";
}
