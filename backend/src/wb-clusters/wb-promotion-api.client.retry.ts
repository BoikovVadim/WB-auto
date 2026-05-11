import {
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";

import { readPromotionRetryAfterMs, isTooManyRequestsPromotionError } from "./wb-promotion-api.client.meta";
import { getPromotionMinIntervalMs } from "./wb-promotion-api.client.throttle";

export function isPromotionRetryableError(error: unknown) {
  if (error instanceof GatewayTimeoutException) {
    return true;
  }
  if (error instanceof ServiceUnavailableException) {
    return true;
  }
  if (error instanceof HttpException) {
    const statusCode = error.getStatus();
    return (
      statusCode === HttpStatus.TOO_MANY_REQUESTS ||
      statusCode === HttpStatus.BAD_GATEWAY ||
      statusCode === HttpStatus.SERVICE_UNAVAILABLE ||
      statusCode === HttpStatus.GATEWAY_TIMEOUT
    );
  }
  return false;
}

export function getPromotionRetryDelayMs(
  path: string,
  baseDelayMs: number,
  attempt: number,
  error?: unknown,
) {
  const baseDelay = Math.max(getPromotionMinIntervalMs(path), baseDelayMs * 2 ** attempt);
  if (isTooManyRequestsPromotionError(error)) {
    const retryAfterMs = readPromotionRetryAfterMs(error);
    if (retryAfterMs !== null) {
      return Math.max(baseDelay, retryAfterMs);
    }
    return Math.max(baseDelay, 60_000 * (attempt + 1));
  }
  return baseDelay;
}
