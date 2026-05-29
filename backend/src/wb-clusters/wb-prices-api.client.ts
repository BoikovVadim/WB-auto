/**
 * WB Discounts & Prices API client.
 * Base URL: https://discounts-prices-api.wildberries.ru
 * Auth: standard WB_API_TOKEN (Bearer).
 * Docs: https://openapi.wb.ru/#tag/Ceny
 *
 * GET /api/v2/list/goods/filter — returns current prices and seller discounts per nmId.
 * Max 1000 items per request; paginated by offset.
 */

import { appEnv } from "../common/env";

export type WbGoodsItem = {
  nmID: number;
  vendorCode: string;
  discount: number;
  sizes: {
    price: number;
    discountedPrice: number;
    techSizeName: string;
  }[];
};

type WbGoodsFilterResponse = {
  data: {
    listGoods: WbGoodsItem[];
  } | null;
};

export class WbPricesApiClient {
  private readonly baseUrl = "https://discounts-prices-api.wildberries.ru";

  constructor(private readonly getToken: () => string) {}

  /** Fetches all goods with current prices and seller discounts. */
  async fetchAllGoods(): Promise<WbGoodsItem[]> {
    const token = this.getToken();
    if (!token) throw new Error("WB_API_TOKEN not configured");

    const allItems: WbGoodsItem[] = [];
    let offset = 0;
    const limit = 1000;

    for (;;) {
      const url = new URL(`${this.baseUrl}/api/v2/list/goods/filter`);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => { controller.abort(); }, appEnv.wbStatisticsApiTimeoutMs);

      let items: WbGoodsItem[];
      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`WB Prices API ${response.status}: ${body}`);
        }

        const data = await response.json() as WbGoodsFilterResponse;
        items = data.data?.listGoods ?? [];
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }

      allItems.push(...items);

      if (items.length < limit) break;
      offset += limit;
    }

    return allItems;
  }
}
