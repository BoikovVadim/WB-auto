import { Inject, Injectable } from "@nestjs/common";

import { WbClustersRepository } from "./wb-clusters.repository";
import type { GlobalPercentMetric } from "./wb-clusters.repository.unit-economics";

export type UnitEconomicsSubjectSetting = {
  subject: string;
  commissionPercent: number | null;
};

export type UnitEconomicsSettings = {
  subjects: UnitEconomicsSubjectSetting[];
  taxPercent: number | null;
  acquiringPercent: number | null;
  drrPercent: number | null;
};

/** Ретроспектива эквайринга: товары × отчётные недели (% и суммы для взвешенного «Итого»). */
export type AcquiringMatrix = {
  weeks: { start: string; end: string }[];
  products: {
    nmId: number;
    percents: (number | null)[];
    fees: number[];
    retails: number[];
  }[];
};

export type UnitEconomicsChargeItem = {
  nmId: number;
  taxRub: number | null;
  commissionRub: number | null;
  acquiringRub: number | null;
  /**
   * Применённый % эквайринга по товару: фактический средневзвешенный за последнюю
   * закрытую неделю (если были продажи), иначе — ручной глобальный %. null, если ни
   * того, ни другого нет.
   */
  acquiringPercent: number | null;
  /** true — % взят из отчёта о реализации (факт); false — подставлен ручной глобальный %. */
  acquiringIsFactual: boolean;
  drrRub: number | null;
  /** Маржа в ₽ на единицу: цена со скидкой − себестоимость − комиссия − эквайринг − ДРР. */
  marginRub: number | null;
  /** Маржа в % к цене со скидкой (marginRub / цена со скидкой × 100). */
  marginPercent: number | null;
};

const GLOBAL_PERCENT_METRICS: readonly GlobalPercentMetric[] = ["tax", "acquiring", "drr"];

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
      return { subjects: [], taxPercent: null, acquiringPercent: null, drrPercent: null };
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
      taxPercent: global.taxPercent,
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
   * Маржа = цена со скидкой − себестоимость − комиссия − эквайринг − ДРР − налог (до
   * логистики/хранения — этих данных пока нет). Незаданные вычеты считаются как 0; без
   * себестоимости маржа = null (прибыль без с/с не определить).
   */
  async getCharges(): Promise<{ items: UnitEconomicsChargeItem[] }> {
    if (!this.repository.isConfigured()) return { items: [] };
    await this.repository.ensureSchema();
    const [catalog, latestPrices, commissions, global, costPrices, acquiringWeekly] =
      await Promise.all([
        this.repository.listProductCatalogItems(),
        this.repository.getLatestPrices(),
        this.repository.getSubjectCommissions(),
        this.repository.getGlobalSettings(),
        this.repository.getAllCurrentCostPrices(),
        this.repository.getLatestWeekAcquiring(),
      ]);
    const commissionBySubject = new Map(commissions.map((c) => [c.subjectName, c.commissionPercent]));
    const priceByNmId = new Map(latestPrices.map((p) => [p.nmId, p]));
    const costByNmId = new Map(costPrices.map((c) => [c.nmId, c.costValue]));
    // nmId → фактический эквайринг за последнюю закрытую неделю (суммы fee/retail).
    const acquiringByNmId = new Map(acquiringWeekly.map((a) => [a.nmId, a]));
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
      // Эквайринг: фактический средневзвешенный % за последнюю закрытую неделю
      // (Σ acquiring_fee / Σ retail_amount × 100), если по товару были продажи;
      // иначе fallback на ручной глобальный %. Маржа считается по применённому %.
      const acquiringFact = acquiringByNmId.get(product.nmId);
      const factualAcquiringPercent =
        acquiringFact && acquiringFact.retailAmountSum > 0
          ? round2((acquiringFact.acquiringFeeSum / acquiringFact.retailAmountSum) * 100)
          : null;
      const acquiringIsFactual = factualAcquiringPercent != null;
      const acquiringPercent = factualAcquiringPercent ?? global.acquiringPercent;
      const acquiringRub = applyPercent(priceWithDiscount, acquiringPercent);
      const drrRub = applyPercent(priceWithDiscount, global.drrPercent);
      const taxRub = applyPercent(priceWithDiscount, global.taxPercent);

      const cost = costByNmId.get(product.nmId) ?? null;
      let marginRub: number | null = null;
      let marginPercent: number | null = null;
      if (cost != null) {
        const deductions =
          (commissionRub ?? 0) + (acquiringRub ?? 0) + (drrRub ?? 0) + (taxRub ?? 0);
        marginRub = round2(priceWithDiscount - cost - deductions);
        marginPercent =
          priceWithDiscount > 0 ? round2((marginRub / priceWithDiscount) * 100) : null;
      }

      if (
        taxRub === null &&
        commissionRub === null &&
        acquiringRub === null &&
        drrRub === null &&
        marginRub === null
      ) {
        continue;
      }
      items.push({
        nmId: product.nmId,
        taxRub,
        commissionRub,
        acquiringRub,
        acquiringPercent,
        acquiringIsFactual,
        drrRub,
        marginRub,
        marginPercent,
      });
    }
    return { items };
  }

  /**
   * Ретроспектива фактического эквайринга: товары × отчётные недели. Для каждой недели
   * по товару — средневзвешенный % (Σfee/Σretail × 100) плюс суммы fee/retail, чтобы
   * фронт мог посчитать взвешенный «Итого» по столбцу-неделе. Считается на сервере,
   * фронт только рисует матрицу (VirtualMatrixTable).
   */
  async getAcquiringMatrix(): Promise<AcquiringMatrix> {
    if (!this.repository.isConfigured()) return { weeks: [], products: [] };
    await this.repository.ensureSchema();
    const history = await this.repository.getAcquiringWeeklyHistory();

    // Отчётные недели (по week_start), по возрастанию; end берём из первой встреченной строки.
    const weekEndByStart = new Map<string, string>();
    for (const r of history) {
      if (!weekEndByStart.has(r.weekStart)) weekEndByStart.set(r.weekStart, r.weekEnd);
    }
    const weekStarts = Array.from(weekEndByStart.keys()).sort();
    const weekIdx = new Map(weekStarts.map((w, i) => [w, i]));
    const weeks = weekStarts.map((start) => ({ start, end: weekEndByStart.get(start) ?? start }));

    const byNmId = new Map<number, AcquiringMatrix["products"][number]>();
    for (const r of history) {
      const idx = weekIdx.get(r.weekStart);
      if (idx === undefined) continue;
      let row = byNmId.get(r.nmId);
      if (!row) {
        row = {
          nmId: r.nmId,
          percents: new Array<number | null>(weeks.length).fill(null),
          fees: new Array<number>(weeks.length).fill(0),
          retails: new Array<number>(weeks.length).fill(0),
        };
        byNmId.set(r.nmId, row);
      }
      row.fees[idx] = r.acquiringFeeSum;
      row.retails[idx] = r.retailAmountSum;
      row.percents[idx] =
        r.retailAmountSum > 0 ? round2((r.acquiringFeeSum / r.retailAmountSum) * 100) : null;
    }

    return { weeks, products: Array.from(byNmId.values()) };
  }
}
