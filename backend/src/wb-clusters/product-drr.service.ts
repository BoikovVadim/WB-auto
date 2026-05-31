import { Injectable } from "@nestjs/common";

import { WbClustersService } from "./wb-clusters.service";

/**
 * ДРР (доля рекламных расходов) по товарам = расход на рекламу / выручка × 100.
 *
 * Метрика полностью считается ЗДЕСЬ, на сервере (фронт только рисует). Числитель —
 * расход рекламы, знаменатель — выручка; обе метрики уже считаются в WbClustersService
 * (getTodayAdSpend/getAdSpendMatrixCompact и getTodayRevenue/getRevenueMatrixCompact),
 * поэтому ДРР переиспользует их как есть — один источник истины, ДРР всегда сходится с
 * колонками «Реклама» и «Выручка». Значение есть, как только есть расход (>0): если при
 * этом нет выручки (нет заказов) — ДРР = 100% (вся реклама без отдачи), иначе
 * расход/выручка × 100. Без расхода товар не рекламируется — ячейки нет.
 *
 * Отдельной таблицы/крона нет — расход и выручка уже хранятся по дням, ретроспектива
 * «за неделю и далее» получается из расхода (revenue добавляется как знаменатель, где
 * есть). Вынесено отдельным сервисом-сиблингом (а не в god-файл WbClustersService),
 * как UnitEconomicsService.
 */
@Injectable()
export class ProductDrrService {
  constructor(private readonly wbClustersService: WbClustersService) {}

  /**
   * Сегодняшний ДРР по товарам. Есть расход (>0) → есть значение: с выручкой —
   * расход/выручка × 100; без выручки (нет заказов) — 100% (вся реклама без отдачи).
   */
  async getTodayDrr(): Promise<{ items: { nmId: number; drr: number }[] }> {
    const [adSpend, revenue] = await Promise.all([
      this.wbClustersService.getTodayAdSpend(),
      this.wbClustersService.getTodayRevenue(),
    ]);
    const revenueByNmId = new Map<number, number>();
    for (const r of revenue.items) revenueByNmId.set(r.nmId, r.revenue);
    const items: { nmId: number; drr: number }[] = [];
    for (const s of adSpend.items) {
      if (s.spend <= 0) continue;
      const rev = revenueByNmId.get(s.nmId);
      const drr = rev != null && rev > 0 ? (s.spend / rev) * 100 : 100;
      items.push({ nmId: s.nmId, drr });
    }
    return { items };
  }

  /**
   * Compact-матрица «товары × даты» ДРР. На товар — параллельные массивы: `drr` (%) для
   * отображения ячейки и `spend`/`revenue` (₽) — компоненты ВЗВЕШЕННОГО «Итого» по столбцу
   * (Σspend / Σrevenue × 100), как у маржи/эквайринга. Колонки = дни, где у товара есть
   * расход (>0); если в этот день нет выручки, ячейка = 100% и `revenue` = null (в Σrevenue
   * не идёт, но spend идёт в Σspend → «Итого» = общий расход / общая выручка). «Сегодня»
   * сюда не попадает (у выручки нет снапшота % выкупа за сегодня) — фронт рисует его live.
   */
  async getDrrMatrixCompact(): Promise<{
    dates: string[];
    products: {
      nmId: number;
      drr: (number | null)[];
      spend: (number | null)[];
      revenue: (number | null)[];
    }[];
  }> {
    const [adSpend, revenue] = await Promise.all([
      this.wbClustersService.getAdSpendMatrixCompact(),
      this.wbClustersService.getRevenueMatrixCompact(),
    ]);

    // spend[nmId] и revenue[nmId] как Map<date, value> — для поэлементного деления.
    const spendByNm = new Map<number, Map<string, number>>();
    for (const p of adSpend.products) {
      const m = new Map<string, number>();
      for (let i = 0; i < adSpend.dates.length; i++) {
        const v = p.vals[i];
        if (v != null && v > 0) m.set(adSpend.dates[i]!, v);
      }
      if (m.size > 0) spendByNm.set(p.nmId, m);
    }
    const revByNm = new Map<number, Map<string, number>>();
    for (const p of revenue.products) {
      const m = new Map<string, number>();
      for (let i = 0; i < revenue.dates.length; i++) {
        const v = p.vals[i];
        if (v != null && v > 0) m.set(revenue.dates[i]!, v);
      }
      if (m.size > 0) revByNm.set(p.nmId, m);
    }

    // ДРР существует для (товар, день) с расходом (>0). С выручкой — расход/выручка × 100;
    // без выручки (нет заказов) — 100%, revenue = null (не идёт в Σrevenue «Итого»).
    const cellsByNm = new Map<
      number,
      Map<string, { drr: number; spend: number; revenue: number | null }>
    >();
    const datesSet = new Set<string>();
    for (const [nmId, spendDates] of spendByNm) {
      const revDates = revByNm.get(nmId);
      const cells = new Map<string, { drr: number; spend: number; revenue: number | null }>();
      for (const [date, spend] of spendDates) {
        const rev = revDates?.get(date);
        const hasRev = rev != null && rev > 0;
        cells.set(date, {
          drr: hasRev ? (spend / rev) * 100 : 100,
          spend,
          revenue: hasRev ? rev : null,
        });
        datesSet.add(date);
      }
      if (cells.size > 0) cellsByNm.set(nmId, cells);
    }

    const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1)); // DESC
    const dateIdx = new Map<string, number>();
    dates.forEach((d, i) => dateIdx.set(d, i));

    const products = Array.from(cellsByNm.entries()).map(([nmId, cells]) => {
      const drr = new Array<number | null>(dates.length).fill(null);
      const spend = new Array<number | null>(dates.length).fill(null);
      const revenueArr = new Array<number | null>(dates.length).fill(null);
      for (const [date, cell] of cells) {
        const i = dateIdx.get(date);
        if (i === undefined) continue;
        drr[i] = cell.drr;
        spend[i] = cell.spend;
        revenueArr[i] = cell.revenue;
      }
      return { nmId, drr, spend, revenue: revenueArr };
    });
    return { dates, products };
  }
}
