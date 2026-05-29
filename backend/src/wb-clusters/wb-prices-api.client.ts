/**
 * WB Discounts & Prices API client.
 * Base URL: https://discounts-prices-api.wildberries.ru
 * Auth: standard WB_API_TOKEN (Bearer).
 * Docs: https://openapi.wb.ru/#tag/Ceny
 *
 * GET /api/v2/list/goods/filter — returns current prices and seller discounts per nmId.
 * Max 1000 items per request; paginated by offset.
 *
 * POST /api/v2/upload/task — uploads a price/discount change (async task). WB
 * stores `price` (integer rubles) and `discount` (integer %); the storefront
 * price is price × (1 − discount/100). ⚠️ Запись реальной цены на маркетплейс.
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

  /**
   * Uploads a single product's base price + discount to WB (async task).
   * Returns the WB task id (uploadID). Throws on non-2xx or WB error flag.
   *
   * ⚠️ Это единственный метод, который РЕАЛЬНО меняет цену на маркетплейсе.
   * `price` и `discount` обязаны быть целыми (WB не принимает копейки/доли %).
   */
  async uploadPrice(nmID: number, price: number, discount: number): Promise<number> {
    const token = this.getToken();
    if (!token) throw new Error("WB_API_TOKEN not configured");

    const intPrice = Math.round(price);
    const intDiscount = Math.round(discount);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(); }, appEnv.wbStatisticsApiTimeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/api/v2/upload/task`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data: [{ nmID, price: intPrice, discount: intDiscount }] }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await response.text().catch(() => "");
      if (!response.ok) {
        throw new Error(`WB Prices upload ${response.status}: ${text}`);
      }

      let parsed: { data?: { id?: number } | null; error?: boolean; errorText?: string };
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        throw new Error(`WB Prices upload: невалидный ответ: ${text}`);
      }
      if (parsed.error) {
        throw new Error(`WB Prices upload отклонён: ${parsed.errorText || "неизвестная ошибка"}`);
      }
      const id = parsed.data?.id;
      if (typeof id !== "number") {
        throw new Error(`WB Prices upload: нет task id в ответе: ${text}`);
      }
      return id;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}
