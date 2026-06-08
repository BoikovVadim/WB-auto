import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import { appEnv } from "../common/env";
import { WbRuntimeConfigService } from "../wb-sync/wb-runtime-config.service";
import { isTooManyRequestsPromotionError } from "./wb-promotion-api.client.meta";
import { getPromotionRetryDelayMs, isPromotionRetryableError } from "./wb-promotion-api.client.retry";
import type {
  PromotionRequestConfig,
  PromotionRequestOptions,
} from "./wb-promotion-api.client.shared";
import {
  buildPromotionRequestUrl,
  requestWbPromotionOnce,
} from "./wb-promotion-api.client.transport";
import {
  createPromotionLaneTelemetryMap,
  buildPromotionLaneTelemetrySnapshot,
  recordPromotionRequestFailure,
  recordPromotionRequestStart,
  recordPromotionRequestSuccess,
} from "./wb-promotion-api.client.telemetry";
import {
  createPromotionThrottleStates,
  extendPromotionLaneCooldown,
  getPromotionLaneCooldownRemainingMs,
  getPromotionThrottleLane,
  waitForPromotionRequestSlot,
} from "./wb-promotion-api.client.throttle";
import {
  extendCooldownTarget,
  getRemainingDelayMs,
  sleep,
} from "./wb-promotion-api.client.timing";
import type {
  PromotionCampaignCountResponse,
  PromotionCampaignDetailsResponse,
  PromotionAdvUpdResponse,
  PromotionDailyNormQueryStatsResponse,
  PromotionFullstatsResponse,
  PromotionKeywordStatsResponse,
  PromotionMinimumProductBidsRequest,
  PromotionNormQueryBidsResponse,
  PromotionNormQueryMinusResponse,
  PromotionNormQueryListResponse,
  PromotionNormQueryStatsResponse,
  PromotionSetNormQueryBidsRequest,
  PromotionThrottleLane,
} from "./wb-clusters.types";

@Injectable()
export class WbPromotionApiClient {
  private backgroundSuppressedUntilMs = 0;
  private readonly throttleStates = createPromotionThrottleStates();
  private readonly laneTelemetry = createPromotionLaneTelemetryMap();

  constructor(
    @Inject(WbRuntimeConfigService)
    private readonly wbRuntimeConfigService: WbRuntimeConfigService,
  ) {}

  prioritizeBidWrites(durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return;
    }
    this.extendGlobalCooldownForBackground(durationMs);
  }

  hasActiveBackgroundReadSuppression() {
    return this.getBackgroundReadSuppressionRemainingMs() > 0;
  }

  getBackgroundReadSuppressionRemainingMs() {
    return getRemainingDelayMs(this.backgroundSuppressedUntilMs);
  }

  hasActiveSellerCooldown() {
    return this.getSellerCooldownRemainingMs() > 0;
  }

  getSellerCooldownRemainingMs() {
    return Math.max(this.getBidWriteCooldownRemainingMs(), this.getMinusWriteCooldownRemainingMs());
  }

  hasActiveBidWriteCooldown() {
    return this.getBidWriteCooldownRemainingMs() > 0;
  }

  getBidWriteCooldownRemainingMs() {
    return this.getLaneCooldownRemainingMs("bid-write");
  }

  hasActiveMinusWriteCooldown() {
    return this.getMinusWriteCooldownRemainingMs() > 0;
  }

  getMinusWriteCooldownRemainingMs() {
    return this.getLaneCooldownRemainingMs("minus-write");
  }

  getTelemetrySnapshot() {
    return {
      backgroundReadSuppressionRemainingMs: this.getBackgroundReadSuppressionRemainingMs(),
      sellerCooldownRemainingMs: this.getSellerCooldownRemainingMs(),
      lanes: {
        "bid-write": this.buildLaneTelemetrySnapshot("bid-write"),
        "minus-write": this.buildLaneTelemetrySnapshot("minus-write"),
        "bid-read": this.buildLaneTelemetrySnapshot("bid-read"),
        "minus-read": this.buildLaneTelemetrySnapshot("minus-read"),
        details: this.buildLaneTelemetrySnapshot("details"),
        stats: this.buildLaneTelemetrySnapshot("stats"),
        default: this.buildLaneTelemetrySnapshot("default"),
      },
    };
  }

  async getCampaignCounts(options?: { failFastOnTooManyRequests?: boolean; maxQueueWaitMs?: number }) {
    return this.request<PromotionCampaignCountResponse>({ method: "GET", path: "/adv/v1/promotion/count" }, options);
  }

  async getCampaignDetails(ids: number[], options?: { failFastOnTooManyRequests?: boolean; maxQueueWaitMs?: number }) {
    if (ids.length === 0) {
      return { adverts: [] satisfies PromotionCampaignDetailsResponse["adverts"] };
    }
    return this.request<PromotionCampaignDetailsResponse>({ method: "GET", path: "/api/advert/v2/adverts", query: { ids: ids.join(",") } }, options);
  }

  async getNormQueryList(items: Array<{ advertId: number; nmId: number }>) {
    if (items.length === 0) {
      return { items: [] satisfies PromotionNormQueryListResponse["items"] };
    }
    return this.request<PromotionNormQueryListResponse>({ method: "POST", path: "/adv/v0/normquery/list", body: { items } });
  }

  async getNormQueryStats(params: { from: string; to: string; items: Array<{ advert_id: number; nm_id: number }> }) {
    if (params.items.length === 0) {
      return { stats: [] satisfies PromotionNormQueryStatsResponse["stats"] };
    }
    return this.request<PromotionNormQueryStatsResponse>({ method: "POST", path: "/adv/v0/normquery/stats", body: params });
  }

  async getNormQueryBids(items: Array<{ advert_id: number; nm_id: number }>, options?: { failFastOnTooManyRequests?: boolean; maxQueueWaitMs?: number }) {
    if (items.length === 0) {
      return { bids: [] satisfies NonNullable<PromotionNormQueryBidsResponse["bids"]> };
    }
    return this.request<PromotionNormQueryBidsResponse>({ method: "POST", path: "/adv/v0/normquery/get-bids", body: { items } }, options);
  }

  async getMinimumProductBids(input: PromotionMinimumProductBidsRequest, options?: { failFastOnTooManyRequests?: boolean; maxQueueWaitMs?: number }) {
    if (input.nm_ids.length === 0) {
      return null;
    }
    return this.request<unknown>({ method: "POST", path: "/api/advert/v1/bids/min", body: { advert_id: input.advert_id, nm_ids: input.nm_ids, payment_type: input.payment_type, placement_types: input.placement_types } }, options);
  }

  async setNormQueryBids(input: PromotionSetNormQueryBidsRequest, options?: { failFastOnTooManyRequests?: boolean; maxQueueWaitMs?: number }) {
    if (input.bids.length === 0) {
      return;
    }
    await this.request<void>({ method: "POST", path: "/adv/v0/normquery/bids", body: { bids: input.bids } }, options);
  }

  async getNormQueryMinus(items: Array<{ advert_id: number; nm_id: number }>) {
    if (items.length === 0) {
      return { items: [] satisfies NonNullable<PromotionNormQueryMinusResponse["items"]> };
    }
    return this.request<PromotionNormQueryMinusResponse>({ method: "POST", path: "/adv/v0/normquery/get-minus", body: { items } });
  }

  async setNormQueryMinus(items: Array<{ advert_id: number; nm_id: number; norm_queries: string[] }>, options?: { failFastOnTooManyRequests?: boolean; maxQueueWaitMs?: number }) {
    if (items.length === 0) {
      return { items: [] satisfies NonNullable<PromotionNormQueryMinusResponse["items"]> };
    }
    const results: NonNullable<PromotionNormQueryMinusResponse["items"]> = [];
    for (const item of items) {
      try {
        await this.request<void>({ method: "POST", path: "/adv/v0/normquery/set-minus", body: item }, options);
      } catch (error) {
        // set-minus идёт по одному HTTP на кампанию и НЕ атомарен: если упали на середине,
        // часть кампаний WB уже применил. Прокидываем их списком на ошибке, чтобы вызывающий
        // синхронизировал локальное зеркало по факту и ретрай не откатил кабинет старым набором.
        if (error && typeof error === "object") {
          (error as { appliedMinusItems?: PromotionNormQueryMinusResponse["items"] }).appliedMinusItems =
            [...results];
        }
        throw error;
      }
      results.push({ advert_id: item.advert_id, nm_id: item.nm_id, norm_queries: item.norm_queries });
    }
    return { items: results } satisfies PromotionNormQueryMinusResponse;
  }

  async getDailyNormQueryStats(params: { from: string; to: string; items: Array<{ advertId: number; nmId: number }> }) {
    if (params.items.length === 0) {
      return { items: [] satisfies NonNullable<PromotionDailyNormQueryStatsResponse["items"]> };
    }
    return this.request<PromotionDailyNormQueryStatsResponse>({ method: "POST", path: "/adv/v1/normquery/stats", body: params });
  }

  async getAdvUpd(params: { from: string; to: string }) {
    // GET /adv/v1/upd — история затрат за период (дешёвый pre-filter тративших РК).
    return this.request<PromotionAdvUpdResponse>({
      method: "GET",
      path: "/adv/v1/upd",
      query: { from: params.from, to: params.to },
    });
  }

  async getFullstats(params: { advertIds: number[]; from: string; to: string }) {
    if (params.advertIds.length === 0) {
      return [] satisfies PromotionFullstatsResponse;
    }
    // WB удалил POST /adv/v2/fullstats (дедлайн 23.10.2025). Актуальный метод —
    // GET /adv/v3/fullstats: ids через запятую, beginDate/endDate в YYYY-MM-DD,
    // макс. период 31 день. Структура ответа (days[].apps[].nm[].sum) та же.
    return this.request<PromotionFullstatsResponse>(
      {
        method: "GET",
        path: "/adv/v3/fullstats",
        query: {
          ids: params.advertIds.join(","),
          beginDate: params.from,
          endDate: params.to,
        },
      },
      { failFastOnTooManyRequests: false },
    );
  }

  async getKeywordStats(params: { advertId: number; from: string; to: string }) {
    return this.request<PromotionKeywordStatsResponse>({ method: "GET", path: "/adv/v0/stats/keywords", query: { advert_id: String(params.advertId), from: params.from, to: params.to } });
  }

  private async request<T>(
    config: PromotionRequestConfig,
    options?: PromotionRequestOptions,
  ): Promise<T> {
    const resolvedToken = this.wbRuntimeConfigService.getResolvedPromotionToken();
    if (!resolvedToken) {
      throw new BadRequestException("Не настроен токен WB Promotion API. Проверьте `WB_PROMOTION_API_TOKEN` или runtime-настройку.");
    }
    const retryAttempts = appEnv.wbPromotionRetryAttempts;
    const retryBaseDelayMs = appEnv.wbPromotionRetryBaseDelayMs;
    const throttleLane = getPromotionThrottleLane(config.path);
    const laneTelemetry = this.laneTelemetry[throttleLane];
    const requestUrl = buildPromotionRequestUrl(config.path, config.query);

    for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
      try {
        const slotWaitMs = await waitForPromotionRequestSlot({
          path: config.path,
          lane: throttleLane,
          throttleStates: this.throttleStates,
          backgroundSuppressionRemainingMs: this.getBackgroundReadSuppressionRemainingMs(),
          options,
          sleep,
        });
        recordPromotionRequestStart(laneTelemetry, config.path, slotWaitMs);
        const requestStartedAtMs = Date.now();
        const response = await requestWbPromotionOnce<T>(
          { ...config, path: requestUrl },
          resolvedToken,
        );
        const durationMs = Date.now() - requestStartedAtMs;
        recordPromotionRequestSuccess(laneTelemetry, durationMs);
        return response;
      } catch (error) {
        const isTooManyRequests = isTooManyRequestsPromotionError(error);
        recordPromotionRequestFailure(
          laneTelemetry,
          error instanceof HttpException ? error.getStatus() : null,
          attempt > 0,
          isTooManyRequests,
        );
        if (options?.failFastOnTooManyRequests && isTooManyRequests) {
          throw error;
        }
        if (!isPromotionRetryableError(error) || attempt === retryAttempts) {
          if (
            error instanceof BadRequestException ||
            error instanceof BadGatewayException ||
            error instanceof GatewayTimeoutException ||
            error instanceof ServiceUnavailableException ||
            error instanceof HttpException
          ) {
            throw error;
          }
          throw new ServiceUnavailableException("Не удалось выполнить запрос к WB Promotion API.");
        }
        const retryDelayMs = getPromotionRetryDelayMs(
          config.path,
          retryBaseDelayMs,
          attempt,
          error,
        );
        extendPromotionLaneCooldown(this.throttleStates, throttleLane, retryDelayMs);
        if (isTooManyRequests) {
          this.extendGlobalCooldownForBackground(retryDelayMs);
        }
        await sleep(retryDelayMs);
      }
    }
    throw new ServiceUnavailableException("Не удалось выполнить запрос к WB Promotion API.");
  }

  private extendGlobalCooldownForBackground(delayMs: number) {
    this.backgroundSuppressedUntilMs = extendCooldownTarget(
      this.backgroundSuppressedUntilMs,
      delayMs,
    );
  }

  private getLaneCooldownRemainingMs(lane: PromotionThrottleLane) {
    return getPromotionLaneCooldownRemainingMs(this.throttleStates, lane);
  }

  private buildLaneTelemetrySnapshot(lane: PromotionThrottleLane) {
    return buildPromotionLaneTelemetrySnapshot(this.throttleStates, this.laneTelemetry, lane);
  }
}
