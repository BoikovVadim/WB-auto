import { Inject, Injectable } from "@nestjs/common";

import { WbClustersRepository } from "./wb-clusters.repository";

export type UnitEconomicsCategorySetting = {
  category: string;
  commissionPercent: number | null;
};

export type UnitEconomicsSettings = {
  categories: UnitEconomicsCategorySetting[];
  acquiringPercent: number | null;
};

export type UnitEconomicsChargeItem = {
  nmId: number;
  commissionRub: number | null;
  acquiringRub: number | null;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Юнит-экономика: настройки (комиссия по категориям + эквайринг) и производные
 * суммы в ₽ на товар. Единый источник истины для формул — здесь, на сервере; фронт
 * только рисует. Отдельный сервис (а не god-WbClustersService), как ProductCatalogService.
 */
@Injectable()
export class UnitEconomicsService {
  constructor(
    @Inject(WbClustersRepository)
    private readonly repository: WbClustersRepository,
  ) {}

  /** Все категории каталога с их комиссией (% или null, если не задана) + эквайринг. */
  async getSettings(): Promise<UnitEconomicsSettings> {
    if (!this.repository.isConfigured()) {
      return { categories: [], acquiringPercent: null };
    }
    await this.repository.ensureSchema();
    const [categories, commissions, acquiringPercent] = await Promise.all([
      this.repository.getDistinctCategoryNames(),
      this.repository.getCategoryCommissions(),
      this.repository.getAcquiringPercent(),
    ]);
    const byCategory = new Map(commissions.map((c) => [c.categoryName, c.commissionPercent]));
    return {
      categories: categories.map((category) => ({
        category,
        commissionPercent: byCategory.get(category) ?? null,
      })),
      acquiringPercent,
    };
  }

  async setCategoryCommission(category: string, commissionPercent: number) {
    if (!this.repository.isConfigured()) throw new Error("PostgreSQL не настроен.");
    await this.repository.ensureSchema();
    const value = round2(commissionPercent);
    await this.repository.upsertCategoryCommission(category, value);
    return { category, commissionPercent: value };
  }

  async clearCategoryCommission(category: string) {
    if (!this.repository.isConfigured()) throw new Error("PostgreSQL не настроен.");
    await this.repository.ensureSchema();
    await this.repository.deleteCategoryCommission(category);
  }

  async setAcquiringPercent(acquiringPercent: number | null) {
    if (!this.repository.isConfigured()) throw new Error("PostgreSQL не настроен.");
    await this.repository.ensureSchema();
    const value = acquiringPercent === null ? null : round2(acquiringPercent);
    await this.repository.setAcquiringPercent(value);
    return { acquiringPercent: value };
  }

  /**
   * Комиссия и эквайринг в ₽ на каждый товар. База — цена со скидкой
   * (price × (1 − discount/100)), как в колонке «Цена». Комиссия берётся по
   * категории товара, эквайринг — глобальный. null, если для категории нет % или
   * эквайринг не задан (фронт рисует «—»). Товары без текущей цены пропускаются.
   */
  async getCharges(): Promise<{ items: UnitEconomicsChargeItem[] }> {
    if (!this.repository.isConfigured()) return { items: [] };
    await this.repository.ensureSchema();
    const [catalog, latestPrices, commissions, acquiringPercent] = await Promise.all([
      this.repository.listProductCatalogItems(),
      this.repository.getLatestPrices(),
      this.repository.getCategoryCommissions(),
      this.repository.getAcquiringPercent(),
    ]);
    const commissionByCategory = new Map(commissions.map((c) => [c.categoryName, c.commissionPercent]));
    const priceByNmId = new Map(latestPrices.map((p) => [p.nmId, p]));

    const items: UnitEconomicsChargeItem[] = [];
    for (const product of catalog) {
      const price = priceByNmId.get(product.nmId);
      if (!price) continue;
      const priceWithDiscount = round2(price.price * (1 - price.discount / 100));
      const commissionPercent =
        product.categoryName != null ? commissionByCategory.get(product.categoryName) ?? null : null;
      const commissionRub =
        commissionPercent != null ? round2(priceWithDiscount * (commissionPercent / 100)) : null;
      const acquiringRub =
        acquiringPercent != null ? round2(priceWithDiscount * (acquiringPercent / 100)) : null;
      if (commissionRub === null && acquiringRub === null) continue;
      items.push({ nmId: product.nmId, commissionRub, acquiringRub });
    }
    return { items };
  }
}
