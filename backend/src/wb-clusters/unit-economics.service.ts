import { Inject, Injectable } from "@nestjs/common";

import { WbClustersRepository } from "./wb-clusters.repository";
import type { MarginSnapshotRow } from "./wb-clusters.repository.margin-snapshot";
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

/**
 * Ретроспектива маржи: товары × даты. dates отсортированы DESC, dates[0] = today (Москва,
 * считается на лету), остальные — закрытые дни из снапшота. По товару выровненные с dates
 * массивы marginRub/marginPercent/priceWithDiscount (цена нужна фронту для взвешенного
 * «Итого, %»). Всё считается на сервере (одна формула marginAt), фронт только рисует.
 */
export type MarginMatrix = {
  today: string;
  dates: string[];
  products: {
    nmId: number;
    marginRub: (number | null)[];
    marginPercent: (number | null)[];
    priceWithDiscount: (number | null)[];
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

/**
 * Базис юнит-экономики на товар: цена со скидкой, себестоимость и применённые %-ставки
 * вычетов (комиссия по предмету, эквайринг факт/ручной, ДРР, налог). Единый промежуточный
 * слой для всех производных: и колонки charges, и калькуляторы маржи/цены отталкиваются
 * от него (одна формула — один источник истины). Только товары с текущей ценой.
 */
type UnitEconomicsBase = {
  priceWithDiscount: number;
  cost: number | null;
  commissionPercent: number | null;
  acquiringPercent: number | null;
  acquiringIsFactual: boolean;
  drrPercent: number | null;
  taxPercent: number | null;
};

/** Калькулятор «целевая маржа → нужная цена со скидкой». feasible=false — маржа недостижима/нет с/с. */
export type MarginToPriceResult = { nmId: number; price: number | null; feasible: boolean };
/** Калькулятор «цена со скидкой → маржа %». null — нет с/с или цена ≤ 0. */
export type PriceToMarginResult = { nmId: number; marginPercent: number | null };
export type UnitEconomicsCalcResult = {
  marginToPrice: MarginToPriceResult[];
  priceToMargin: PriceToMarginResult[];
};
export type UnitEconomicsCalcInput = {
  marginToPrice: { nmId: number; targetMarginPercent: number }[];
  priceToMargin: { nmId: number; price: number }[];
};

const GLOBAL_PERCENT_METRICS: readonly GlobalPercentMetric[] = ["tax", "acquiring", "drr"];

function assertGlobalPercentMetric(metric: string): GlobalPercentMetric {
  if ((GLOBAL_PERCENT_METRICS as readonly string[]).includes(metric)) {
    return metric as GlobalPercentMetric;
  }
  throw new Error(`Неизвестная метрика: ${metric}`);
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** ₽ вычета: процент от цены со скидкой (per-component round2, как в колонках). null% → не применяется. */
function chargeRub(priceWithDiscount: number, percent: number | null): number | null {
  return percent != null ? round2(priceWithDiscount * (percent / 100)) : null;
}

/**
 * Маржа на единицу при заданной цене со скидкой — ЕДИНАЯ формула для колонки «Маржа»
 * и калькулятора «цена → маржа» (одна логика, без расхождений). Вычеты округляются
 * покомпонентно (как в колонках комиссии/эквайринга/ДРР/налога), незаданные = 0:
 *   маржа₽ = цена − с/с − Σ round2(цена × ставка%/100),  маржа% = маржа₽ / цена × 100.
 */
function marginAt(
  priceWithDiscount: number,
  cost: number,
  b: Pick<UnitEconomicsBase, "commissionPercent" | "acquiringPercent" | "drrPercent" | "taxPercent">,
): { marginRub: number; marginPercent: number | null } {
  const deductions =
    (chargeRub(priceWithDiscount, b.commissionPercent) ?? 0) +
    (chargeRub(priceWithDiscount, b.acquiringPercent) ?? 0) +
    (chargeRub(priceWithDiscount, b.drrPercent) ?? 0) +
    (chargeRub(priceWithDiscount, b.taxPercent) ?? 0);
  const marginRub = round2(priceWithDiscount - cost - deductions);
  const marginPercent = priceWithDiscount > 0 ? round2((marginRub / priceWithDiscount) * 100) : null;
  return { marginRub, marginPercent };
}

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
   * Базис юнит-экономики по каждому товару: ЭФФЕКТИВНАЯ цена со скидкой, с/с и применённые
   * %-ставки вычетов. Общий промежуточный слой для charges и калькуляторов (формула в одном
   * месте). Эффективная цена = ровно то, что показывает колонка «Цена»: оптимистичный
   * desiredFinal из очереди изменения цены (если пользователь её менял), иначе суточный
   * снапшот round2(price×(1−discount/100)). Без единого источника цены маржа и калькулятор
   * расходились с колонкой «Цена». Эквайринг — факт за неделю (Σfee/Σretail), иначе ручной %.
   */
  private async loadUnitEconomicsBase(): Promise<Map<number, UnitEconomicsBase>> {
    const [catalog, latestPrices, priceChanges, commissions, global, costPrices, acquiringWeekly] =
      await Promise.all([
        this.repository.listProductCatalogItems(),
        this.repository.getLatestPrices(),
        this.repository.getPriceChangeRows(),
        this.repository.getSubjectCommissions(),
        this.repository.getGlobalSettings(),
        this.repository.getAllCurrentCostPrices(),
        this.repository.getLatestWeekAcquiring(),
      ]);
    const commissionBySubject = new Map(commissions.map((c) => [c.subjectName, c.commissionPercent]));
    const priceByNmId = new Map(latestPrices.map((p) => [p.nmId, p]));
    // nmId → оптимистичная цена со скидкой, выставленная пользователем (что видно в «Цене»).
    const desiredFinalByNmId = new Map(priceChanges.map((c) => [c.nmId, c.desiredFinal]));
    const costByNmId = new Map(costPrices.map((c) => [c.nmId, c.costValue]));
    // nmId → фактический эквайринг за последнюю закрытую неделю (суммы fee/retail).
    const acquiringByNmId = new Map(acquiringWeekly.map((a) => [a.nmId, a]));

    const base = new Map<number, UnitEconomicsBase>();
    for (const product of catalog) {
      // Эффективная цена со скидкой = как в колонке «Цена»: overlay desiredFinal, иначе снапшот.
      const desiredFinal = desiredFinalByNmId.get(product.nmId);
      const snapshot = priceByNmId.get(product.nmId);
      const priceWithDiscount =
        desiredFinal != null
          ? round2(desiredFinal)
          : snapshot
            ? round2(snapshot.price * (1 - snapshot.discount / 100))
            : null;
      if (priceWithDiscount == null) continue;
      const commissionPercent =
        product.subjectName != null ? commissionBySubject.get(product.subjectName) ?? null : null;
      // Эквайринг: фактический средневзвешенный % за последнюю закрытую неделю
      // (Σ acquiring_fee / Σ retail_amount × 100), если по товару были продажи;
      // иначе fallback на ручной глобальный %.
      const acquiringFact = acquiringByNmId.get(product.nmId);
      const factualAcquiringPercent =
        acquiringFact && acquiringFact.retailAmountSum > 0
          ? round2((acquiringFact.acquiringFeeSum / acquiringFact.retailAmountSum) * 100)
          : null;
      base.set(product.nmId, {
        priceWithDiscount,
        cost: costByNmId.get(product.nmId) ?? null,
        commissionPercent,
        acquiringPercent: factualAcquiringPercent ?? global.acquiringPercent,
        acquiringIsFactual: factualAcquiringPercent != null,
        drrPercent: global.drrPercent,
        taxPercent: global.taxPercent,
      });
    }
    return base;
  }

  async getCharges(): Promise<{ items: UnitEconomicsChargeItem[] }> {
    if (!this.repository.isConfigured()) return { items: [] };
    await this.repository.ensureSchema();
    const base = await this.loadUnitEconomicsBase();

    const items: UnitEconomicsChargeItem[] = [];
    for (const [nmId, b] of base) {
      const commissionRub = chargeRub(b.priceWithDiscount, b.commissionPercent);
      const acquiringRub = chargeRub(b.priceWithDiscount, b.acquiringPercent);
      const drrRub = chargeRub(b.priceWithDiscount, b.drrPercent);
      const taxRub = chargeRub(b.priceWithDiscount, b.taxPercent);

      // Маржа — через общий marginAt (та же формула, что у калькулятора «цена → маржа»).
      const margin = b.cost != null ? marginAt(b.priceWithDiscount, b.cost, b) : null;
      const marginRub = margin?.marginRub ?? null;
      const marginPercent = margin?.marginPercent ?? null;

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
        nmId,
        taxRub,
        commissionRub,
        acquiringRub,
        acquiringPercent: b.acquiringPercent,
        acquiringIsFactual: b.acquiringIsFactual,
        drrRub,
        marginRub,
        marginPercent,
      });
    }
    return { items };
  }

  /**
   * Калькуляторы юнит-экономики на ТОМ ЖЕ базисе (та же эффективная цена и с/с, что у
   * колонок маржи/«Цена») — одна логика, без расхождений:
   *   • «цена → маржа»: marginAt(цена) — ровно формула колонки «Маржа» (покомпонентное
   *     округление), поэтому при вводе цены товара получается ровно его маржа из колонки;
   *   • «маржа → цена»: closed-form инверсия цена = с/с / (1 − k − маржа%/100), k = Σставок/100
   *     (знаменатель ≤ 0 → маржа недостижима). Линейная инверсия — погрешность покомпонентного
   *     округления < 0.05 ₽, на уровне «ввели округлённый %».
   * Без себестоимости результат не определён (null/feasible=false), как и сама маржа.
   */
  async computeCalc(input: UnitEconomicsCalcInput): Promise<UnitEconomicsCalcResult> {
    if (!this.repository.isConfigured()) return { marginToPrice: [], priceToMargin: [] };
    await this.repository.ensureSchema();
    const base = await this.loadUnitEconomicsBase();
    // Доля вычетов от цены со скидкой (незаданная ставка = 0, как в формуле маржи).
    const rate = (b: UnitEconomicsBase): number =>
      ((b.commissionPercent ?? 0) +
        (b.acquiringPercent ?? 0) +
        (b.drrPercent ?? 0) +
        (b.taxPercent ?? 0)) /
      100;

    const marginToPrice: MarginToPriceResult[] = input.marginToPrice.map(
      ({ nmId, targetMarginPercent }) => {
        const b = base.get(nmId);
        if (!b || b.cost == null) return { nmId, price: null, feasible: false };
        const denominator = 1 - rate(b) - targetMarginPercent / 100;
        if (denominator <= 0) return { nmId, price: null, feasible: false };
        return { nmId, price: round2(b.cost / denominator), feasible: true };
      },
    );

    const priceToMargin: PriceToMarginResult[] = input.priceToMargin.map(({ nmId, price }) => {
      const b = base.get(nmId);
      if (!b || b.cost == null || price <= 0) return { nmId, marginPercent: null };
      return { nmId, marginPercent: marginAt(price, b.cost, b).marginPercent };
    });

    return { marginToPrice, priceToMargin };
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

  /**
   * Материализует снапшот маржи за закрытый «вчера» (Москва): считает текущую маржу той же
   * формулой, что и колонка/калькулятор (marginAt по эффективной цене и с/с), и апсертит
   * строку на товар. Товары без себестоимости пропускаются (маржа не определена). Серия
   * копится вперёд от запуска, backfill истории не делаем (см. схему таблицы). Идемпотентно.
   */
  async materializeMarginSnapshotForYesterday(): Promise<{
    rowsWritten: number;
    snapshotDate: string;
  }> {
    if (!this.repository.isConfigured()) return { rowsWritten: 0, snapshotDate: "" };
    await this.repository.ensureSchema();
    const [snapshotDate, base] = await Promise.all([
      this.repository.getMoscowDate(-1),
      this.loadUnitEconomicsBase(),
    ]);

    const rows: MarginSnapshotRow[] = [];
    for (const [nmId, b] of base) {
      if (b.cost == null) continue; // без с/с маржа не определена
      const { marginRub, marginPercent } = marginAt(b.priceWithDiscount, b.cost, b);
      rows.push({ nmId, priceWithDiscount: b.priceWithDiscount, marginRub, marginPercent });
    }
    const rowsWritten = await this.repository.upsertMarginSnapshotRows(snapshotDate, rows);
    return { rowsWritten, snapshotDate };
  }

  /**
   * Ретроспектива маржи (товары × даты) для листа VirtualMatrixTable. Закрытые дни берёт
   * из снапшота, «сегодня» считает на лету (та же формула, что у колонки маржи), и ставит
   * его первой датой. priceWithDiscount возвращается per-cell, чтобы фронт считал взвешенный
   * «Итого, %» (Σмаржа₽ / Σцены × 100), как в inline-колонке.
   */
  async getMarginMatrix(): Promise<MarginMatrix> {
    if (!this.repository.isConfigured()) return { today: "", dates: [], products: [] };
    await this.repository.ensureSchema();
    const [snapshot, today, base] = await Promise.all([
      this.repository.getMarginSnapshotMatrix(),
      this.repository.getMoscowDate(0),
      this.loadUnitEconomicsBase(),
    ]);

    // Закрытые дни снапшота без сегодня (на случай ручного снапшота за сегодня) — DESC.
    const pastDates = snapshot.dates.filter((d) => d !== today);
    const pastSnapshotIdx = pastDates.map((d) => snapshot.dates.indexOf(d));
    const dates = [today, ...pastDates];

    // «Сегодня» на лету: маржа по эффективной цене и с/с (товары без с/с — нет данных).
    const todayByNmId = new Map<number, { marginRub: number; marginPercent: number | null; price: number }>();
    for (const [nmId, b] of base) {
      if (b.cost == null) continue;
      const { marginRub, marginPercent } = marginAt(b.priceWithDiscount, b.cost, b);
      todayByNmId.set(nmId, { marginRub, marginPercent, price: b.priceWithDiscount });
    }

    const snapByNmId = new Map(snapshot.products.map((p) => [p.nmId, p]));
    const nmIds = new Set<number>([...todayByNmId.keys(), ...snapByNmId.keys()]);

    const products: MarginMatrix["products"] = [];
    for (const nmId of nmIds) {
      const marginRub = new Array<number | null>(dates.length).fill(null);
      const marginPercent = new Array<number | null>(dates.length).fill(null);
      const priceWithDiscount = new Array<number | null>(dates.length).fill(null);

      const t = todayByNmId.get(nmId);
      if (t) {
        marginRub[0] = t.marginRub;
        marginPercent[0] = t.marginPercent;
        priceWithDiscount[0] = t.price;
      }
      const snap = snapByNmId.get(nmId);
      if (snap) {
        for (let i = 0; i < pastDates.length; i++) {
          const si = pastSnapshotIdx[i]!;
          marginRub[i + 1] = snap.marginRub[si] ?? null;
          marginPercent[i + 1] = snap.marginPercent[si] ?? null;
          priceWithDiscount[i + 1] = snap.priceWithDiscount[si] ?? null;
        }
      }
      products.push({ nmId, marginRub, marginPercent, priceWithDiscount });
    }

    return { today, dates, products };
  }
}
