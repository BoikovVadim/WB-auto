import { Inject, Injectable } from "@nestjs/common";

import { WbClustersRepository } from "./wb-clusters.repository";
import type { GlobalPercentMetric } from "./wb-clusters.repository.unit-economics";

export type UnitEconomicsCategorySetting = {
  category: string;
  commissionPercent: number | null;
};

export type UnitEconomicsSettings = {
  categories: UnitEconomicsCategorySetting[];
  acquiringPercent: number | null;
  drrPercent: number | null;
};

export type UnitEconomicsChargeItem = {
  nmId: number;
  commissionRub: number | null;
  acquiringRub: number | null;
  drrRub: number | null;
};

const GLOBAL_PERCENT_METRICS: readonly GlobalPercentMetric[] = ["acquiring", "drr"];

function assertGlobalPercentMetric(metric: string): GlobalPercentMetric {
  if ((GLOBAL_PERCENT_METRICS as readonly string[]).includes(metric)) {
    return metric as GlobalPercentMetric;
  }
  throw new Error(`Неизвестная метрика: ${metric}`);
}

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

  /** Категории каталога с их комиссией (% или null) + глобальные %-метрики. */
  async getSettings(): Promise<UnitEconomicsSettings> {
    if (!this.repository.isConfigured()) {
      return { categories: [], acquiringPercent: null, drrPercent: null };
    }
    await this.repository.ensureSchema();
    const [categories, commissions, global] = await Promise.all([
      this.repository.getDistinctCategoryNames(),
      this.repository.getCategoryCommissions(),
      this.repository.getGlobalSettings(),
    ]);
    const byCategory = new Map(commissions.map((c) => [c.categoryName, c.commissionPercent]));
    return {
      categories: categories.map((category) => ({
        category,
        commissionPercent: byCategory.get(category) ?? null,
      })),
      acquiringPercent: global.acquiringPercent,
      drrPercent: global.drrPercent,
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

  /** Запись глобальной %-метрики (acquiring/drr); null очищает. */
  async setGlobalPercent(metric: string, value: number | null) {
    if (!this.repository.isConfigured()) throw new Error("PostgreSQL не настроен.");
    const safeMetric = assertGlobalPercentMetric(metric);
    await this.repository.ensureSchema();
    const rounded = value === null ? null : round2(value);
    await this.repository.setGlobalPercent(safeMetric, rounded);
    return { metric: safeMetric, value: rounded };
  }

  /**
   * Комиссия, эквайринг и ДРР в ₽ на каждый товар. База — цена со скидкой
   * (price × (1 − discount/100)), как в колонке «Цена». Комиссия берётся по
   * категории товара; эквайринг и ДРР — глобальные %. null, если для категории нет %
   * или метрика не задана (фронт рисует «—»). Товары без текущей цены пропускаются.
   */
  async getCharges(): Promise<{ items: UnitEconomicsChargeItem[] }> {
    if (!this.repository.isConfigured()) return { items: [] };
    await this.repository.ensureSchema();
    const [catalog, latestPrices, commissions, global] = await Promise.all([
      this.repository.listProductCatalogItems(),
      this.repository.getLatestPrices(),
      this.repository.getCategoryCommissions(),
      this.repository.getGlobalSettings(),
    ]);
    const commissionByCategory = new Map(commissions.map((c) => [c.categoryName, c.commissionPercent]));
    const priceByNmId = new Map(latestPrices.map((p) => [p.nmId, p]));
    const applyPercent = (base: number, percent: number | null): number | null =>
      percent != null ? round2(base * (percent / 100)) : null;

    const items: UnitEconomicsChargeItem[] = [];
    for (const product of catalog) {
      const price = priceByNmId.get(product.nmId);
      if (!price) continue;
      const priceWithDiscount = round2(price.price * (1 - price.discount / 100));
      const commissionPercent =
        product.categoryName != null ? commissionByCategory.get(product.categoryName) ?? null : null;
      const commissionRub = applyPercent(priceWithDiscount, commissionPercent);
      const acquiringRub = applyPercent(priceWithDiscount, global.acquiringPercent);
      const drrRub = applyPercent(priceWithDiscount, global.drrPercent);
      if (commissionRub === null && acquiringRub === null && drrRub === null) continue;
      items.push({ nmId: product.nmId, commissionRub, acquiringRub, drrRub });
    }
    return { items };
  }
}
