import { describe, expect, it, vi } from "vitest";

import { createPromotionThrottleStates } from "./wb-promotion-api.client.throttle";
import {
  buildPromotionLaneTelemetrySnapshot,
  createEmptyPromotionLaneTelemetry,
  createPromotionLaneTelemetryMap,
  recordPromotionRequestFailure,
  recordPromotionRequestStart,
  recordPromotionRequestSuccess,
} from "./wb-promotion-api.client.telemetry";

describe("wb promotion lane telemetry", () => {
  it("creates telemetry for every throttle lane", () => {
    const telemetryMap = createPromotionLaneTelemetryMap();

    expect(Object.keys(telemetryMap).sort()).toEqual([
      "bid-read",
      "bid-write",
      "default",
      "details",
      "fullstats",
      "minus-read",
      "minus-write",
      "stats",
    ]);
  });

  it("records request lifecycle metrics and builds a snapshot", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-05-07T12:00:00.000Z"));

    const telemetry = createEmptyPromotionLaneTelemetry();
    const throttleStates = createPromotionThrottleStates();
    throttleStates.details.pendingRequests = 2;

    recordPromotionRequestStart(telemetry, "/api/advert/v2/adverts", 500);
    vi.setSystemTime(new Date("2024-05-07T12:00:02.000Z"));
    recordPromotionRequestSuccess(telemetry, 2_000);
    vi.setSystemTime(new Date("2024-05-07T12:00:03.000Z"));
    recordPromotionRequestFailure(telemetry, 429, true, true);

    const snapshot = buildPromotionLaneTelemetrySnapshot(
      throttleStates,
      { ...createPromotionLaneTelemetryMap(), details: telemetry },
      "details",
    );

    expect(snapshot.pendingRequests).toBe(2);
    expect(snapshot.requestsStarted).toBe(1);
    expect(snapshot.requestsCompleted).toBe(1);
    expect(snapshot.requestsFailed).toBe(1);
    expect(snapshot.retryCount).toBe(1);
    expect(snapshot.tooManyRequestsCount).toBe(1);
    expect(snapshot.avgWaitMs).toBe(500);
    expect(snapshot.avgDurationMs).toBe(2_000);
    expect(snapshot.lastPath).toBe("/api/advert/v2/adverts");
    expect(snapshot.lastErrorStatusCode).toBe(429);
    expect(snapshot.lastStartedAt).toBe("2024-05-07T12:00:00.000Z");
    expect(snapshot.lastFinishedAt).toBe("2024-05-07T12:00:03.000Z");

    vi.useRealTimers();
  });
});
