import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";

import { appEnv } from "../common/env";
import {
  extractPromotionPayloadDetail,
  parsePromotionResponse,
  readPromotionResponseMeta,
} from "./wb-promotion-api.client.meta";
import type { PromotionRequestConfig } from "./wb-promotion-api.client.shared";

export function buildPromotionRequestUrl(path: string, query?: Record<string, string>) {
  const url = new URL(path, `${appEnv.wbPromotionApiBaseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export async function requestWbPromotionOnce<T>(
  config: Pick<PromotionRequestConfig, "method" | "path" | "body">,
  resolvedToken: string,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), appEnv.wbPromotionApiTimeoutMs);
  try {
    const response = await fetch(config.path, {
      method: config.method,
      headers: { Authorization: resolvedToken, "Content-Type": "application/json" },
      body: config.method === "POST" ? JSON.stringify(config.body ?? {}) : undefined,
      signal: controller.signal,
    });
    const payload = await parsePromotionResponse(response);
    const responseMeta = readPromotionResponseMeta(response);
    if (!response.ok) {
      const payloadDetail = extractPromotionPayloadDetail(payload);
      if (response.status === HttpStatus.BAD_REQUEST) {
        throw new BadRequestException({
          message: payloadDetail
            ? `WB Promotion API отклонил запрос: ${payloadDetail}`
            : "WB Promotion API отклонил запрос.",
          statusCode: response.status,
          payload,
          responseMeta,
        });
      }
      if (response.status === HttpStatus.FORBIDDEN) {
        throw new HttpException(
          {
            message: payloadDetail
              ? `WB Promotion API запретил доступ: ${payloadDetail}`
              : "WB Promotion API запретил доступ. Проверьте права Promotion API.",
            statusCode: response.status,
            payload,
            responseMeta,
          },
          response.status,
        );
      }
      if (response.status === HttpStatus.TOO_MANY_REQUESTS) {
        throw new HttpException(
          {
            message: payloadDetail
              ? `WB Promotion API временно ограничил запросы: ${payloadDetail}`
              : "WB Promotion API временно ограничил запросы. Попробуйте позже.",
            statusCode: response.status,
            payload,
            responseMeta,
          },
          response.status,
        );
      }
      throw new BadGatewayException({
        message: payloadDetail
          ? `WB Promotion API вернул ошибку ${response.status}: ${payloadDetail}`
          : `WB Promotion API вернул ошибку ${response.status}.`,
        statusCode: response.status,
        payload,
        responseMeta,
      });
    }
    return payload as T;
  } catch (error) {
    if (
      error instanceof BadRequestException ||
      error instanceof BadGatewayException ||
      error instanceof GatewayTimeoutException ||
      error instanceof ServiceUnavailableException ||
      error instanceof HttpException
    ) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new GatewayTimeoutException("WB Promotion API не ответил вовремя на запрос.");
    }
    const causeMessage = error instanceof Error && error.message ? error.message : "";
    throw new ServiceUnavailableException(
      causeMessage
        ? `Не удалось выполнить запрос к WB Promotion API. Причина: ${causeMessage}`
        : "Не удалось выполнить запрос к WB Promotion API.",
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
