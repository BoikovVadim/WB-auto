import { HttpException, HttpStatus } from "@nestjs/common";

import type { PromotionResponseMeta } from "./wb-promotion-api.client.shared";

export async function parsePromotionResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function extractPromotionPayloadDetail(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const detailValue = "detail" in payload ? payload.detail : null;
  if (typeof detailValue === "string" && detailValue.trim()) {
    return detailValue.trim();
  }
  const titleValue = "title" in payload ? payload.title : null;
  if (typeof titleValue === "string" && titleValue.trim()) {
    return titleValue.trim();
  }
  const messageValue = "message" in payload ? payload.message : null;
  if (typeof messageValue === "string" && messageValue.trim()) {
    return messageValue.trim();
  }
  return "";
}

export function isTooManyRequestsPromotionError(error: unknown) {
  return error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS;
}

export function readPromotionResponseMeta(response: Response): PromotionResponseMeta {
  return {
    requestId: response.headers.get("x-request-id"),
    rateLimitRetry: readPromotionHeaderInteger(response.headers, "x-ratelimit-retry"),
    rateLimitLimit: readPromotionHeaderInteger(response.headers, "x-ratelimit-limit"),
    rateLimitReset: readPromotionHeaderInteger(response.headers, "x-ratelimit-reset"),
  };
}

export function readPromotionHeaderInteger(headers: Headers, headerName: string) {
  const rawValue = headers.get(headerName);
  if (!rawValue) {
    return null;
  }
  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

export function readPromotionRetryAfterMs(error: unknown) {
  if (!(error instanceof HttpException)) {
    return null;
  }
  const response = error.getResponse();
  if (
    !response ||
    typeof response !== "object" ||
    !("responseMeta" in response) ||
    !response.responseMeta ||
    typeof response.responseMeta !== "object"
  ) {
    return null;
  }
  const retrySeconds =
    "rateLimitRetry" in response.responseMeta &&
    typeof response.responseMeta.rateLimitRetry === "number"
      ? response.responseMeta.rateLimitRetry
      : null;
  if (retrySeconds === null || retrySeconds < 0) {
    return null;
  }
  return retrySeconds * 1000;
}
