import {
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import { describe, expect, it } from "vitest";

import {
  getPromotionRetryDelayMs,
  isPromotionRetryableError,
} from "./wb-promotion-api.client.retry";

describe("wb promotion api retry helpers", () => {
  it("marks gateway timeout, service unavailable, and retryable http codes as retryable", () => {
    expect(isPromotionRetryableError(new GatewayTimeoutException())).toBe(true);
    expect(isPromotionRetryableError(new ServiceUnavailableException())).toBe(true);
    expect(
      isPromotionRetryableError(new HttpException("retry", HttpStatus.TOO_MANY_REQUESTS)),
    ).toBe(true);
    expect(
      isPromotionRetryableError(new HttpException("not retryable", HttpStatus.BAD_REQUEST)),
    ).toBe(false);
  });

  it("uses the larger of exponential backoff and lane minimum interval", () => {
    expect(getPromotionRetryDelayMs("/adv/v0/normquery/bids", 100, 0)).toBe(700);
    expect(getPromotionRetryDelayMs("/api/unknown", 2_000, 2)).toBe(8_000);
  });

  it("respects retry-after metadata for 429 responses", () => {
    const tooManyRequestsError = new HttpException(
      {
        message: "Too many requests",
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        responseMeta: {
          requestId: "req-1",
          rateLimitRetry: 90,
          rateLimitReset: 90,
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    expect(
      getPromotionRetryDelayMs("/adv/v0/normquery/get-bids", 1_000, 1, tooManyRequestsError),
    ).toBe(90_000);
  });

  it("falls back to escalating minute windows for 429 responses without retry metadata", () => {
    const tooManyRequestsError = new HttpException(
      {
        message: "Too many requests",
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    expect(
      getPromotionRetryDelayMs("/adv/v0/normquery/get-minus", 1_000, 2, tooManyRequestsError),
    ).toBe(180_000);
  });
});
