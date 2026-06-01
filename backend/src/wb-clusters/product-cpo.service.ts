import { Injectable } from "@nestjs/common";

import { UnitEconomicsService } from "./unit-economics.service";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbClustersService } from "./wb-clusters.service";

/**
 * CPO (максимальная цена за заказ) по товарам = (выручка / кол-во заказов) × ДРР%.
 *
 * Это потолок рекламной ставки на один заказ при целевом ДРР: за заказ можно платить
 * не больше, чем целевая доля от ожидаемой выручки этого заказа. Раскрытие формулы:
 *   выручка / заказы = (Σзаказов_₽ × %выкупа) / кол-во_заказов
 *                    = средняя цена заказа × %выкупа
 * то есть CPO = цена заказа × %выкупа × ДРР% — ровно как закладывается в настройках.
 *
 * Метрика полностью считается ЗДЕСЬ, на сервере (фронт только рисует). Числитель и
 * знаменатель уже считаются в WbClustersService (getTodayRevenue/getRevenueMatrixCompact
 * и getTodayOrderCounts/getOrdersMatrixCompact) — CPO переиспользует их как есть, один
 * источник истины, всегда сходится с колонками «Выручка» и «Заказы». Целевой ДРР —
 * глобальная настройка wb_unit_economics_settings.drr_percent (та же, что вычитается из
 * маржи в юнит-экономике). Без таблицы/крона: ретроспектива получается из пересечения
 * дат выручки (окно % выкупа) и заказов. Вынесено сиблингом (а не в god-файл
 * WbClustersService), как ProductDrrService/UnitEconomicsService.
 */
@Injectable()
export class ProductCpoService {
  constructor(
    private readonly wbClustersService: WbClustersService,
    private readonly unitEconomicsService: UnitEconomicsService,
    private readonly repository: WbClustersRepository,
  ) {}

  /**
   * Сегодняшний CPO по товарам. Значение есть, когда задан целевой ДРР, есть выручка
   * и есть заказы (>0). На товар отдаём `cpo` (₽) + `revenue`/`orders` — для взвешенного
   * «Итого» по столбцу = (Σrevenue / Σorders) × ДРР%, а не среднее CPO строк.
   */
  async getTodayCpo(): Promise<{
    drrPercent: number | null;
    items: { nmId: number; cpo: number; revenue: number; orders: number }[];
  }> {
    const drrPercent = (await this.repository.getGlobalSettings()).drrPercent;
    if (drrPercent == null) return { drrPercent: null, items: [] };

    const [revenue, orders] = await Promise.all([
      this.wbClustersService.getTodayRevenue(),
      this.wbClustersService.getTodayOrderCounts(),
    ]);
    const ordersByNmId = new Map<number, number>();
    for (const o of orders.items) ordersByNmId.set(o.nmId, o.ordersCount);

    const items: { nmId: number; cpo: number; revenue: number; orders: number }[] = [];
    for (const r of revenue.items) {
      if (r.revenue <= 0) continue;
      const ordersCount = ordersByNmId.get(r.nmId);
      if (ordersCount == null || ordersCount <= 0) continue;
      const cpo = (r.revenue / ordersCount) * (drrPercent / 100);
      items.push({ nmId: r.nmId, cpo, revenue: r.revenue, orders: ordersCount });
    }
    return { drrPercent, items };
  }

  /**
   * CPO-планка одного товара (для шапки рекламного воркспейса). В отличие от колонки
   * «CPO» (today-факт = выручка/заказы за сегодня, которой нет в дни без продаж), планка
   * СТАБИЛЬНА и считается из юнитки: цена со скидкой × %выкупа (rolling 365) × ДРР%.
   * `maxCpo` = CPO × 2 — потолок цены за заказ для ставок кластеров. ×2 и вся формула —
   * ЗДЕСЬ, на сервере; фронт только рисует. null, если нет цены / истории выкупа / ДРР.
   */
  async getProductCpo(nmId: number): Promise<{
    nmId: number;
    cpo: number | null;
    maxCpo: number | null;
    drrPercent: number | null;
  }> {
    const [prices, buyout, settings] = await Promise.all([
      this.unitEconomicsService.getEffectivePrices(),
      this.wbClustersService.getRollingBuyoutCounts(365),
      this.repository.getGlobalSettings(),
    ]);
    const drrPercent = settings.drrPercent;
    const price = prices.get(nmId) ?? null;
    const b = buyout.items.find((x) => x.nmId === nmId);
    const buyoutRatio =
      b && b.ordersCount > 0 ? b.buyoutsCount / b.ordersCount : null;

    const cpo =
      drrPercent != null && price != null && buyoutRatio != null
        ? price * buyoutRatio * (drrPercent / 100)
        : null;
    return {
      nmId,
      cpo,
      maxCpo: cpo !== null ? cpo * 2 : null,
      drrPercent,
    };
  }

  /**
   * Compact-матрица «товары × даты» CPO. На товар — `cpo` (₽) для ячейки + `revenue`/`orders`
   * (для взвешенного «Итого»). Колонки = дни ОКНА ВЫРУЧКИ (там, где есть снапшот % выкупа);
   * заказы за тот же день берутся из матрицы заказов. CPO есть, когда выручка >0 и заказы >0.
   * «Сегодня» сюда не попадает (нет снапшота % выкупа за сегодня) — фронт рисует его live.
   */
  async getCpoMatrixCompact(): Promise<{
    drrPercent: number | null;
    dates: string[];
    products: {
      nmId: number;
      cpo: (number | null)[];
      revenue: (number | null)[];
      orders: (number | null)[];
    }[];
  }> {
    const drrPercent = (await this.repository.getGlobalSettings()).drrPercent;
    if (drrPercent == null) return { drrPercent: null, dates: [], products: [] };

    const [revenue, orders] = await Promise.all([
      this.wbClustersService.getRevenueMatrixCompact(),
      this.wbClustersService.getOrdersMatrixCompact(),
    ]);

    // orders[nmId] как Map<date, count> — для поэлементного деления по тем же датам.
    const ordersByNm = new Map<number, Map<string, number>>();
    for (const p of orders.products) {
      const m = new Map<string, number>();
      for (let i = 0; i < orders.dates.length; i++) {
        const v = p.vals[i];
        if (v != null && v > 0) m.set(orders.dates[i]!, v);
      }
      if (m.size > 0) ordersByNm.set(p.nmId, m);
    }

    const k = drrPercent / 100;
    const datesSet = new Set<string>();
    const cellsByNm = new Map<
      number,
      Map<string, { cpo: number; revenue: number; orders: number }>
    >();
    for (const p of revenue.products) {
      const ordDates = ordersByNm.get(p.nmId);
      if (!ordDates) continue;
      const cells = new Map<string, { cpo: number; revenue: number; orders: number }>();
      for (let i = 0; i < revenue.dates.length; i++) {
        const rev = p.vals[i];
        if (rev == null || rev <= 0) continue;
        const date = revenue.dates[i]!;
        const ord = ordDates.get(date);
        if (ord == null || ord <= 0) continue;
        cells.set(date, { cpo: (rev / ord) * k, revenue: rev, orders: ord });
        datesSet.add(date);
      }
      if (cells.size > 0) cellsByNm.set(p.nmId, cells);
    }

    const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1)); // DESC
    const dateIdx = new Map<string, number>();
    dates.forEach((d, i) => dateIdx.set(d, i));

    const products = Array.from(cellsByNm.entries()).map(([nmId, cells]) => {
      const cpo = new Array<number | null>(dates.length).fill(null);
      const revenueArr = new Array<number | null>(dates.length).fill(null);
      const ordersArr = new Array<number | null>(dates.length).fill(null);
      for (const [date, cell] of cells) {
        const i = dateIdx.get(date);
        if (i === undefined) continue;
        cpo[i] = cell.cpo;
        revenueArr[i] = cell.revenue;
        ordersArr[i] = cell.orders;
      }
      return { nmId, cpo, revenue: revenueArr, orders: ordersArr };
    });

    return { drrPercent, dates, products };
  }
}
