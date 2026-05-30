import { Inject, Injectable } from "@nestjs/common";

import { WbClustersRepository } from "./wb-clusters.repository";
import type { GlobalPercentMetric } from "./wb-clusters.repository.unit-economics";

export type UnitEconomicsSubjectSetting = {
  subject: string;
  commissionPercent: number | null;
};

export type UnitEconomicsSettings = {
  subjects: UnitEconomicsSubjectSetting[];
  acquiringPercent: number | null;
  drrPercent: number | null;
};

export type UnitEconomicsChargeItem = {
  nmId: number;
  commissionRub: number | null;
  acquiringRub: number | null;
  drrRub: number | null;
  /** Маржа в ₽ на единицу: цена со скидкой − себестоимость − комиссия − эквайринг − ДРР. */
  marginRub: number | null;
  /** Маржа в % к цене со скидкой (marginRub / цена со скидкой × 100). */
  marginPercent: number | null;
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
 * Юнит-экономика: настройки (комиссия по предметам + эквайринг) и производные
 * суммы в ₽ на товар. Единый источник истины для формул — здесь, на сервере; фронт
 * только рисует. Отдельный сервис (а не god-WbClustersService), как ProductCatalogService.
 */
@Injectable()
export class UnitEconomicsService {
  constructor(
    @Inject(WbClustersRepository)
    private readonly repository: WbClustersRepository,
  ) {}

  /** Предметы каталога с их комиссией (% или null) + глобальные %-метрики. */
  async getSettings(): Promise<UnitEconomicsSettings> {
    if (!this.repository.isConfigured()) {
      return { subjects: [], acquiringPercent: null, drrPercent: null };
    }
    await this.repository.ensureSchema();
    const [subjects, commissions, global] = await Promise.all([
      this.repository.getDistinctSubjectNames(),
      this.repository.getSubjectCommissions(),
      this.repository.getGlobalSettings(),
    ]);
    const bySubject = new Map(commissions.map((c) => [c.subjectName, c.commissionPercent]));
    return {
      subjects: subjects.map((subject) => ({
        subject,
        commissionPercent: bySubject.get(subject) ?? null,
      })),
      acquiringPercent: global.acquiringPercent,
      drrPercent: global.drrPercent,
    };
  }

  async setSubjectCommission(subject: string, commissionPercent: number) {
    if (!this.repository.isConfigured()) throw new Error("PostgreSQL не настроен.");
    await this.repository.ensureSchema();
    const value = round2(commissionPercent);
    await this.repository.upsertSubjectCommission(subject, value);
    return { subject, commissionPercent: value };
  }

  async clearSubjectCommission(subject: string) {
    if (!this.repository.isConfigured()) throw new Error("PostgreSQL не настроен.");
    await this.repository.ensureSchema();
    await this.repository.deleteSubjectCommission(subject);
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
   * Комиссия, эквайринг, ДРР и маржа в ₽/% на каждый товар. База — цена со скидкой
   * (price × (1 − discount/100)), как в колонке «Цена». Комиссия берётся по
   * предмету товара; эквайринг и ДРР — глобальные %. null, если для предмета нет %
   * или метрика не задана (фронт рисует «—»). Товары без текущей цены пропускаются.
   *
   * Маржа = цена со скидкой − себестоимость − комиссия − эквайринг − ДРР (до логистики/
   * хранения/налога — этих данных пока нет). Незаданные вычеты считаются как 0; без
   * себестоимости маржа = null (прибыль без с/с не определить).
   */
  async getCharges(): Promise<{ items: UnitEconomicsChargeItem[] }> {
    if (!this.repository.isConfigured()) return { items: [] };
    await this.repository.ensureSchema();
    const [catalog, latestPrices, commissions, global, costPrices] = await Promise.all([
      this.repository.listProductCatalogItems(),
      this.repository.getLatestPrices(),
      this.repository.getSubjectCommissions(),
      this.repository.getGlobalSettings(),
      this.repository.getAllCurrentCostPrices(),
    ]);
    const commissionBySubject = new Map(commissions.map((c) => [c.subjectName, c.commissionPercent]));
    const priceByNmId = new Map(latestPrices.map((p) => [p.nmId, p]));
    const costByNmId = new Map(costPrices.map((c) => [c.nmId, c.costValue]));
    const applyPercent = (base: number, percent: number | null): number | null =>
      percent != null ? round2(base * (percent / 100)) : null;

    const items: UnitEconomicsChargeItem[] = [];
    for (const product of catalog) {
      const price = priceByNmId.get(product.nmId);
      if (!price) continue;
      const priceWithDiscount = round2(price.price * (1 - price.discount / 100));
      const commissionPercent =
        product.subjectName != null ? commissionBySubject.get(product.subjectName) ?? null : null;
      const commissionRub = applyPercent(priceWithDiscount, commissionPercent);
      const acquiringRub = applyPercent(priceWithDiscount, global.acquiringPercent);
      const drrRub = applyPercent(priceWithDiscount, global.drrPercent);

      const cost = costByNmId.get(product.nmId) ?? null;
      let marginRub: number | null = null;
      let marginPercent: number | null = null;
      if (cost != null) {
        const deductions = (commissionRub ?? 0) + (acquiringRub ?? 0) + (drrRub ?? 0);
        marginRub = round2(priceWithDiscount - cost - deductions);
        marginPercent =
          priceWithDiscount > 0 ? round2((marginRub / priceWithDiscount) * 100) : null;
      }

      if (
        commissionRub === null &&
        acquiringRub === null &&
        drrRub === null &&
        marginRub === null
      ) {
        continue;
      }
      items.push({ nmId: product.nmId, commissionRub, acquiringRub, drrRub, marginRub, marginPercent });
    }
    return { items };
  }
}
