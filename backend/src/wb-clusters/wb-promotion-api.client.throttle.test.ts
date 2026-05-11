import { HttpStatus, ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  createPromotionThrottleStates,
  getPromotionBackgroundSuppressionWaitMs,
  getPromotionLaneCooldownRemainingMs,
  getPromotionThrottleLane,
  isPromotionWriteLane,
  waitForPromotionRequestSlot,
} from "./wb-promotion-api.client.throttle";

describe("wb promotion api throttle helpers", () => {
  it("maps paths to stable lanes and write-lane semantics", () => {
    expect(getPromotionThrottleLane("/adv/v0/normquery/bids")).toBe("bid-write");
    expect(getPromotionThrottleLane("/adv/v0/normquery/get-minus")).toBe("minus-read");
    expect(getPromotionThrottleLane("/api/advert/v2/adverts")).toBe("details");
    expect(getPromotionThrottleLane("/other")).toBe("default");
    expect(isPromotionWriteLane("bid-write")).toBe(true);
    expect(isPromotionWriteLane("stats")).toBe(false);
    expect(getPromotionBackgroundSuppressionWaitMs("bid-write", 9_000)).toBe(0);
    expect(getPromotionBackgroundSuppressionWaitMs("details", 9_000)).toBe(9_000);
  });

  it("waits for the larger cooldown and updates the next allowed request time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-05-07T12:00:00.000Z"));

    const throttleStates = createPromotionThrottleStates();
    throttleStates.details.nextAllowedRequestAtMs = Date.now() + 500;
    const sleep = vi.fn().mockResolvedValue(undefined);

    const waitMs = await waitForPromotionRequestSlot({
      path: "/api/advert/v2/adverts",
      lane: "details",
      throttleStates,
      backgroundSuppressionRemainingMs: 2_000,
      sleep,
    });

    expect(waitMs).toBe(2_000);
    expect(sleep).toHaveBeenCalledWith(2_000);
    // After acquiring the slot the lane cooldown is reset to the configured
    // min interval for the details endpoint (WB_PROMOTION_DETAILS_MIN_INTERVAL_MS = 400 ms).
    expect(getPromotionLaneCooldownRemainingMs(throttleStates, "details")).toBe(400);

    vi.useRealTimers();
  });

  it("throws a machine-readable 429 for write lanes under local cooldown pressure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-05-07T12:00:00.000Z"));

    const throttleStates = createPromotionThrottleStates();
    throttleStates["bid-write"].nextAllowedRequestAtMs = Date.now() + 8_100;

    await expect(
      waitForPromotionRequestSlot({
        path: "/adv/v0/normquery/bids",
        lane: "bid-write",
        throttleStates,
        backgroundSuppressionRemainingMs: 0,
        options: { maxQueueWaitMs: 1_000 },
        sleep: vi.fn(),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message:
          "WB write cooldown is active. Latest change is saved locally and will be retried after cooldown.",
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        responseMeta: expect.objectContaining({
          localCooldown: true,
          rateLimitRetry: 9,
          rateLimitReset: 9,
        }),
      }),
    });

    vi.useRealTimers();
  });

  it("throws service unavailable for read lanes when queue wait exceeds the limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-05-07T12:00:00.000Z"));

    const throttleStates = createPromotionThrottleStates();
    throttleStates.details.nextAllowedRequestAtMs = Date.now() + 7_000;

    await expect(
      waitForPromotionRequestSlot({
        path: "/api/advert/v2/adverts",
        lane: "details",
        throttleStates,
        backgroundSuppressionRemainingMs: 0,
        options: { maxQueueWaitMs: 1_000 },
        sleep: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    vi.useRealTimers();
  });
});
