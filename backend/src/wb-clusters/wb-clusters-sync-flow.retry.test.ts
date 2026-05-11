import {
  BadRequestException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  describeError,
  isRecoverablePromotionError,
  pushWarning,
  summarizeWarnings,
  tryPromotionStepWithQuickRetry,
} from "./wb-clusters-sync-flow.retry";

describe("wb clusters sync retry helpers", () => {
  it("treats only recoverable promotion statuses as retryable", () => {
    expect(
      isRecoverablePromotionError({}, new HttpException("retry", HttpStatus.TOO_MANY_REQUESTS)),
    ).toBe(true);
    expect(
      isRecoverablePromotionError({}, new HttpException("retry", HttpStatus.BAD_GATEWAY)),
    ).toBe(true);
    expect(
      isRecoverablePromotionError({}, new BadRequestException("no retry")),
    ).toBe(false);
  });

  it("formats http errors with rate limit and request metadata", () => {
    const error = new HttpException(
      {
        message: "WB busy",
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        responseMeta: {
          rateLimitRetry: 5,
          rateLimitReset: 8,
          requestId: "req-123",
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    expect(describeError({}, error)).toBe(
      "WB busy [status=429 retry=5s reset=8s requestId=req-123]",
    );
  });

  it("deduplicates warnings and keeps the summary bounded", () => {
    const warnings: string[] = [];

    pushWarning({}, warnings, "first");
    pushWarning({}, warnings, "first");
    pushWarning({}, warnings, "second");

    expect(warnings).toEqual(["first", "second"]);
    expect(
      summarizeWarnings({}, ["a", "b", "c", "d", "e", "f"]),
    ).toBe("a | b | c | d | e");
  });

  it("retries recoverable promotion steps and returns null after exhausting attempts", async () => {
    vi.useFakeTimers();

    const warnings: string[] = [];
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(
        new ServiceUnavailableException({
          message: "Temporary issue",
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        }),
      );
    const logger = { warn: vi.fn() };
    const self = {
      logger,
      isRecoverablePromotionError: (error: unknown) =>
        isRecoverablePromotionError({}, error),
      describeError: (error: unknown) => describeError({}, error),
      pushWarning: (target: string[], message: string) => pushWarning({}, target, message),
    };

    const resultPromise = tryPromotionStepWithQuickRetry(
      self,
      "promotion step",
      action,
      warnings,
    );
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toBeNull();
    expect(action).toHaveBeenCalledTimes(4);
    expect(logger.warn).toHaveBeenCalledWith(
      "promotion step: Temporary issue [status=503]",
    );
    expect(warnings).toEqual(["promotion step: Temporary issue [status=503]"]);

    vi.useRealTimers();
  });
});
