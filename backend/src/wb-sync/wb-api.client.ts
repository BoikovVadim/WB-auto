import {
  BadGatewayException,
  BadRequestException,
  Inject,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import { appEnv } from "../common/env";
import { WbRuntimeConfigService } from "./wb-runtime-config.service";

interface WbRequestConfig {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  /** Override the global WB_API_MIN_INTERVAL_MS throttle for this call only. */
  minIntervalMs?: number;
}

@Injectable()
export class WbApiClient {
  private nextAllowedRequestAtMs = 0;
  private requestThrottleQueue = Promise.resolve();

  /** Separate throttle state for JAM API calls — independent of the main limiter. */
  private jamNextAllowedRequestAtMs = 0;
  private jamRequestThrottleQueue = Promise.resolve();

  constructor(
    @Inject(WbRuntimeConfigService)
    private readonly wbRuntimeConfigService: WbRuntimeConfigService,
  ) {}

  async request(config: WbRequestConfig): Promise<unknown> {
    return this.requestWithRetry(config, (resolvedConfig, resolvedToken) =>
      this.requestOnce(resolvedConfig, resolvedToken),
    );
  }

  /**
   * Like `request()` but uses a dedicated JAM rate limiter so that slow JAM
   * throttle (WB_JAM_MIN_INTERVAL_MS ≈ 6 s) does not stall the main sync loop.
   */
  async requestJam(config: Omit<WbRequestConfig, "minIntervalMs">): Promise<unknown> {
    return this.requestWithRetry(
      config,
      (resolvedConfig, resolvedToken) => this.requestOnce(resolvedConfig, resolvedToken),
      true,
    );
  }

  async requestBuffer(config: WbRequestConfig): Promise<Buffer> {
    return this.requestWithRetry(config, (resolvedConfig, resolvedToken) =>
      this.requestBufferOnce(resolvedConfig, resolvedToken),
    );
  }

  private async requestWithRetry<T>(
    config: WbRequestConfig,
    action: (
      config: WbRequestConfig & { path: string; timeoutMs: number },
      resolvedToken: string,
    ) => Promise<T>,
    useJamThrottle = false,
  ): Promise<T> {
    const resolvedToken = this.wbRuntimeConfigService.getResolvedToken();

    if (!resolvedToken) {
      throw new BadRequestException(
        "Не настроен токен WB API. Добавьте WB_API_TOKEN в .env перед выгрузкой.",
      );
    }

    const url = this.buildUrl(config.path, config.query);
    const timeoutMs = config.timeoutMs ?? appEnv.wbApiTimeoutMs;
    const retryAttempts = config.retryAttempts ?? appEnv.wbApiRetryAttempts;
    const retryBaseDelayMs =
      config.retryBaseDelayMs ?? appEnv.wbApiRetryBaseDelayMs;

    for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
      try {
        if (useJamThrottle) {
          await this.waitForJamRequestSlot();
        } else {
          await this.waitForRequestSlot(config.minIntervalMs);
        }
        return await action(
          {
            ...config,
            path: url,
            timeoutMs,
          },
          resolvedToken,
        );
      } catch (error) {
        if (!this.isRetryableError(error) || attempt === retryAttempts) {
          throw error;
        }

        await this.sleep(this.getRetryDelayMs(retryBaseDelayMs, attempt));
      }
    }

    throw new ServiceUnavailableException("Не удалось выполнить запрос к WB API.");
  }

  private buildUrl(
    path: string,
    query?: Record<string, string>,
  ): string {
    const url = new URL(path, `${appEnv.wbApiBaseUrl}/`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  private async requestOnce(
    config: WbRequestConfig & { path: string; timeoutMs: number },
    resolvedToken: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(config.path, {
        method: config.method,
        headers: {
          Authorization: resolvedToken,
          "Content-Type": "application/json",
        },
        body:
          config.method === "POST" ? JSON.stringify(config.body ?? {}) : undefined,
        signal: controller.signal,
      });

      const payload = await this.parseJsonResponse(response);

      if (!response.ok) {
        this.throwHttpError(response.status, payload);
      }

      return payload;
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof BadRequestException ||
        error instanceof HttpException
      ) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new GatewayTimeoutException(
          "WB API не ответил вовремя. Проверьте токен, лимиты и доступность метода.",
        );
      }

      const causeMessage =
        error instanceof Error &&
        "cause" in error &&
        error.cause instanceof Error &&
        error.cause.message
          ? error.cause.message
          : error instanceof Error && error.message
            ? error.message
            : "";

      throw new ServiceUnavailableException(
        causeMessage
          ? `Не удалось выполнить запрос к WB API. Сетевая ошибка: ${causeMessage}`
          : "Не удалось выполнить запрос к WB API.",
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async requestBufferOnce(
    config: WbRequestConfig & { path: string; timeoutMs: number },
    resolvedToken: string,
  ): Promise<Buffer> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(config.path, {
        method: config.method,
        headers: {
          Authorization: resolvedToken,
          "Content-Type": "application/json",
        },
        body:
          config.method === "POST" ? JSON.stringify(config.body ?? {}) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = await this.parseJsonResponse(response);
        this.throwHttpError(response.status, payload);
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof BadRequestException ||
        error instanceof HttpException
      ) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new GatewayTimeoutException(
          "WB API не ответил вовремя. Проверьте токен, лимиты и доступность метода.",
        );
      }

      const causeMessage =
        error instanceof Error &&
        "cause" in error &&
        error.cause instanceof Error &&
        error.cause.message
          ? error.cause.message
          : error instanceof Error && error.message
            ? error.message
            : "";

      throw new ServiceUnavailableException(
        causeMessage
          ? `Не удалось выполнить запрос к WB API. Сетевая ошибка: ${causeMessage}`
          : "Не удалось выполнить запрос к WB API.",
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private throwHttpError(statusCode: number, payload: unknown): never {
    if (statusCode === 429) {
      throw new HttpException(
        "WB API временно ограничил выгрузку по лимиту запросов. Для отчета по поисковым запросам безопасно подождать до 1 часа с последней попытки и запустить выгрузку снова.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (
      statusCode === HttpStatus.BAD_GATEWAY ||
      statusCode === HttpStatus.SERVICE_UNAVAILABLE ||
      statusCode === HttpStatus.GATEWAY_TIMEOUT
    ) {
      throw new HttpException(
        {
          message: "WB API временно недоступен.",
          statusCode,
          payload,
        },
        statusCode,
      );
    }

    throw new BadGatewayException({
      message: "WB API вернул ошибку.",
      statusCode,
      payload,
    });
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof GatewayTimeoutException) {
      return true;
    }

    if (error instanceof ServiceUnavailableException) {
      return true;
    }

    if (error instanceof HttpException) {
      const statusCode = error.getStatus();
      return (
        statusCode === HttpStatus.BAD_GATEWAY ||
        statusCode === HttpStatus.SERVICE_UNAVAILABLE ||
        statusCode === HttpStatus.GATEWAY_TIMEOUT
      );
    }

    return false;
  }

  private getRetryDelayMs(baseDelayMs: number, attempt: number): number {
    return Math.min(
      appEnv.wbApiRetryMaxDelayMs,
      baseDelayMs * 2 ** attempt,
    );
  }

  private async waitForRequestSlot(minIntervalMs?: number): Promise<void> {
    const releaseQueue = await this.enqueueThrottle();

    try {
      const waitMs = Math.max(0, this.nextAllowedRequestAtMs - Date.now());

      if (waitMs > 0) {
        await this.sleep(waitMs);
      }

      this.nextAllowedRequestAtMs = Date.now() + (minIntervalMs ?? appEnv.wbApiMinIntervalMs);
    } finally {
      releaseQueue();
    }
  }

  private async enqueueThrottle(): Promise<() => void> {
    const previous = this.requestThrottleQueue;
    let releaseQueue!: () => void;
    this.requestThrottleQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previous;
    return releaseQueue;
  }

  /** Dedicated throttle for JAM calls — does not touch the main limiter queue. */
  private async waitForJamRequestSlot(): Promise<void> {
    const releaseQueue = await this.enqueueJamThrottle();

    try {
      const waitMs = Math.max(0, this.jamNextAllowedRequestAtMs - Date.now());

      if (waitMs > 0) {
        await this.sleep(waitMs);
      }

      this.jamNextAllowedRequestAtMs = Date.now() + appEnv.wbJamMinIntervalMs;
    } finally {
      releaseQueue();
    }
  }

  private async enqueueJamThrottle(): Promise<() => void> {
    const previous = this.jamRequestThrottleQueue;
    let releaseQueue!: () => void;
    this.jamRequestThrottleQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previous;
    return releaseQueue;
  }

  private async sleep(delayMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private async parseJsonResponse(response: Response): Promise<unknown> {
    const text = await response.text();

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new BadGatewayException(
        "WB API вернул невалидный JSON, поэтому данные не могут быть использованы.",
      );
    }
  }
}
