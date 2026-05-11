import { Inject, Injectable } from "@nestjs/common";

import { appEnv } from "../common/env";
import {
  loadProductSearchTextsRangeByNmId,
  normalizeProductSearchTextsRange,
} from "./product-search-texts-range";
import { WbApiClient } from "./wb-api.client";
import type { ProductSearchTextsRangeResponse } from "./wb-sync.types";

@Injectable()
export class WbProductSearchTextsRangeService {
  private readonly productSearchTextsRangeCache = new Map<
    string,
    {
      expiresAtMs: number;
      value: ProductSearchTextsRangeResponse;
    }
  >();
  private readonly productSearchTextsRangeInFlight = new Map<
    string,
    Promise<ProductSearchTextsRangeResponse>
  >();
  private readonly productSearchTextsRangeCacheTtlMs = 10 * 60 * 1000;

  constructor(
    @Inject(WbApiClient)
    private readonly wbApiClient: WbApiClient,
  ) {}

  async getProductSearchTextsRange(input: {
    nmId: number;
    startDate: string;
    endDate: string;
  }): Promise<ProductSearchTextsRangeResponse> {
    const currentPeriod = normalizeProductSearchTextsRange(input.startDate, input.endDate);
    const cacheKey = this.buildProductSearchTextsRangeCacheKey(
      input.nmId,
      currentPeriod.start,
      currentPeriod.end,
    );
    const cachedValue = this.productSearchTextsRangeCache.get(cacheKey);
    if (cachedValue && cachedValue.expiresAtMs > Date.now()) {
      return cachedValue.value;
    }

    const pendingRequest = this.productSearchTextsRangeInFlight.get(cacheKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    const loadPromise = this.loadProductSearchTextsRange(input.nmId, currentPeriod);
    this.productSearchTextsRangeInFlight.set(cacheKey, loadPromise);

    try {
      const response = await loadPromise;
      this.productSearchTextsRangeCache.set(cacheKey, {
        expiresAtMs: Date.now() + this.productSearchTextsRangeCacheTtlMs,
        value: response,
      });
      return response;
    } finally {
      this.productSearchTextsRangeInFlight.delete(cacheKey);
    }
  }

  private async loadProductSearchTextsRange(
    nmId: number,
    currentPeriod: { start: string; end: string },
  ): Promise<ProductSearchTextsRangeResponse> {
    const searchTexts = await loadProductSearchTextsRangeByNmId({
      nmId,
      currentPeriod,
      request: (body) =>
        this.wbApiClient.request({
          method: "POST",
          path: "/api/v2/search-report/product/search-texts",
          timeoutMs: Math.max(appEnv.wbApiTimeoutMs, 120_000),
          retryAttempts: 0,
          body,
        }),
      preferredTopOrderBy: "openCard",
      limit: 30,
    });

    return {
      nmId,
      checkedAt: new Date().toISOString(),
      period: currentPeriod,
      searchTexts,
    };
  }

  private buildProductSearchTextsRangeCacheKey(
    nmId: number,
    startDate: string,
    endDate: string,
  ) {
    return `${String(nmId)}:${startDate}:${endDate}`;
  }
}
