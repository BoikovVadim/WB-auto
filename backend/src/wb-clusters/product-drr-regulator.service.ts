import { Injectable, Logger } from "@nestjs/common";

import { ProductCpoService } from "./product-cpo.service";
import { ProductDrrService } from "./product-drr.service";
import { computeBidCap, computeClusterCr } from "./product-cluster-bid";
import { WbClustersRepository } from "./wb-clusters.repository";

/** Мёртвая зона регулятора вокруг плана ДРР (±%) — не дёргаемся на мелких отклонениях. */
const DEAD_ZONE_PCT = 0.5;
/** Неполный шаг — двигаем порог на долю расчётного избытка/дефицита (плавная сходимость). */
const STEP_FRACTION = 0.65;

/** Минимальная ставка (для рез по конверсии bid_cap < мин) — тот же параметр, что у bid-движка. */
function minBidEnv(): number {
  const v = Number(process.env.WB_CLUSTER_BID_MIN);
  return Number.isFinite(v) && v > 0 ? v : 100;
}

interface RegClusterRow {
  advertId: number;
  normalizedClusterName: string;
  state: string;
  drrHeld: boolean;
  /** Накопленные заказы в текущей корзине (0 = бесзаказный кандидат на рез). */
  orderedAccrued: number;
  /** Вчерашний расход кластера (₽) — единица рублёвого набора под избыток/дефицит. */
  ydaySpend: number;
  /** Потолок окупаемости (Макс СРО × 1000 × CR); null — нет данных. Для ранжирования заказных. */
  bidCap: number | null;
}

/**
 * Регулятор ДНЕВНОГО ДРР (этап 1E). Раз в день держит фактический ДРР каждого товара у плана,
 * двигая плавающую линию отсечки. Считает РУБЛЁВЫЙ избыток/дефицит (= вчерашний расход −
 * план×выручка), и отключает бесзаказные кластеры по убыванию вчерашнего расхода на сумму
 * избытка (перетрата) либо возвращает придержанные по возрастанию (недотрата). Уровень ЦЕЛИ —
 * товар (ДРР товарный), исполнения — кластер всех его кампаний.
 *
 * Регулятор только ставит/снимает флаг drr_held + state=excluded_drr; применение на WB делает
 * следующий v2-крон (видит drr_held → exclude в live). Работает поверх правила v2 и ТОЛЬКО при
 * включённых флагах: WB_CLUSTER_DECISION_V2=1 (база) + WB_CLUSTER_DRR_REGULATOR=1 (регулятор).
 * См. память project-cluster-ad-strategy (раздел РЕГУЛЯТОР ДНЕВНОГО ДРР).
 */
@Injectable()
export class ProductDrrRegulatorService {
  private readonly logger = new Logger("ProductDrrRegulator");

  constructor(
    private readonly repository: WbClustersRepository,
    private readonly productCpoService: ProductCpoService,
    private readonly productDrrService: ProductDrrService,
  ) {}

  private enabled(): boolean {
    return (
      process.env.WB_CLUSTER_DECISION_V2 === "1" &&
      process.env.WB_CLUSTER_DRR_REGULATOR === "1"
    );
  }

  /** Дневной проход регулятора по всем товарам автоматики. */
  async runDailyForAll(): Promise<void> {
    if (!this.enabled()) return;
    const plan = (await this.repository.getGlobalSettings()).drrPercent;
    if (plan == null) return;
    const drr = await this.productDrrService.getLatestDayDrrInputs();
    if (drr.date == null) return;
    const drrByNm = new Map(drr.items.map((x) => [x.nmId, x]));

    const enabled = await this.repository.listEnabledAutomations();
    const byNm = new Map<number, number[]>();
    for (const a of enabled) {
      const list = byNm.get(a.nmId) ?? [];
      list.push(a.advertId);
      byNm.set(a.nmId, list);
    }

    let touched = 0;
    for (const [nmId, advertIds] of byNm) {
      const di = drrByNm.get(nmId);
      if (!di) continue; // нет расхода вчера → регулировать нечего
      try {
        touched += await this.regulateProduct(nmId, advertIds, di, plan, drr.date);
      } catch (err) {
        this.logger.warn(`regulate nm ${nmId}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`DRR-регулятор ${drr.date}: затронуто ${touched} кластеров`);
  }

  private async regulateProduct(
    nmId: number,
    advertIds: number[],
    di: { spend: number; revenue: number | null; drr: number },
    plan: number,
    date: string,
  ): Promise<number> {
    // Мёртвая зона: ДРР близко к плану — не трогаем.
    if (Math.abs(di.drr - plan) < DEAD_ZONE_PCT) return 0;

    // Целевой расход: план×выручка; при нулевой/малой выручке fallback-кэп = 1 целевой CPO.
    const { cpo, maxCpo } = await this.productCpoService.getProductCpo(nmId);
    const targetSpend =
      di.revenue != null && di.revenue > 0 ? (plan * di.revenue) / 100 : (cpo ?? 0);
    const excess = di.spend - targetSpend; // >0 перетрата, <0 недотрата
    const amount = Math.abs(excess) * STEP_FRACTION; // неполный шаг
    if (amount <= 0) return 0;

    const minBid = minBidEnv();
    const clusters = await this.collectClusters(nmId, advertIds, date, maxCpo);
    const isOrdered = (c: RegClusterRow) => c.orderedAccrued > 0;
    const isUnprofitable = (c: RegClusterRow) => c.bidCap != null && c.bidCap < minBid;

    const toSet: { advertId: number; normalizedClusterName: string; held: boolean }[] = [];
    if (excess > 0) {
      // ПЕРЕТРАТА — выключаем целиком снизу вверх по ценности, пока Σ срезанного ≈ избытку:
      const active = clusters.filter(
        (c) => !c.drrHeld && c.ydaySpend > 0 && (c.state === "active" || c.state === "learning"),
      );
      const cands = [
        // 1) убыточные заказные (bid_cap < мин) — наименее ценные;
        ...active.filter((c) => isOrdered(c) && isUnprofitable(c)).sort((a, b) => b.ydaySpend - a.ydaySpend),
        // 2) бесзаказные по убыванию расхода (большой → мелкий);
        ...active.filter((c) => !isOrdered(c)).sort((a, b) => b.ydaySpend - a.ydaySpend),
        // 3) рентабельные заказные по ВОЗРАСТАНИЮ bid_cap (худшая конверсия первой).
        ...active
          .filter((c) => isOrdered(c) && !isUnprofitable(c))
          .sort((a, b) => (a.bidCap ?? Infinity) - (b.bidCap ?? Infinity)),
      ];
      let acc = 0;
      for (const c of cands) {
        if (acc >= amount) break;
        toSet.push({ advertId: c.advertId, normalizedClusterName: c.normalizedClusterName, held: true });
        acc += c.ydaySpend;
      }
    } else {
      // НЕДОТРАТА — включаем обратным порядком: рентабельные с бóльшим bid_cap → бесзаказные
      // мелкие → крупные (мелкие первыми = шире разведка на тот же бюджет).
      const held = clusters.filter((c) => c.drrHeld);
      const order = [
        ...held.filter((c) => isOrdered(c) && !isUnprofitable(c)).sort((a, b) => (b.bidCap ?? 0) - (a.bidCap ?? 0)),
        ...held.filter((c) => !isOrdered(c)).sort((a, b) => a.ydaySpend - b.ydaySpend),
        ...held.filter((c) => isOrdered(c) && isUnprofitable(c)).sort((a, b) => a.ydaySpend - b.ydaySpend),
      ];
      let acc = 0;
      for (const c of order) {
        if (acc >= amount) break;
        toSet.push({ advertId: c.advertId, normalizedClusterName: c.normalizedClusterName, held: false });
        acc += c.ydaySpend;
      }
    }

    if (toSet.length === 0) return 0;
    // Группируем по кампании и пишем флаг.
    const byAdvert = new Map<number, { normalizedClusterName: string; held: boolean }[]>();
    for (const s of toSet) {
      const list = byAdvert.get(s.advertId) ?? [];
      list.push({ normalizedClusterName: s.normalizedClusterName, held: s.held });
      byAdvert.set(s.advertId, list);
    }
    for (const [advertId, items] of byAdvert) {
      await this.repository.setClusterDrrHeld(advertId, nmId, items);
    }
    return toSet.length;
  }

  /** Собирает кластеры всех кампаний товара: состояние, drr_held, накопл. заказы, расход, bid_cap. */
  private async collectClusters(
    nmId: number,
    advertIds: number[],
    date: string,
    maxCpo: number | null,
  ): Promise<RegClusterRow[]> {
    const rows: RegClusterRow[] = [];
    for (const advertId of advertIds) {
      const [states, cpoInputs, deltas] = await Promise.all([
        this.repository.getClusterAutomationStates(advertId, nmId),
        this.repository.getClusterCpoInputs(advertId, nmId),
        this.repository.getDailyClusterDeltas(advertId, nmId, date),
      ]);
      // Заказы и bid_cap — от РЕАЛЬНЫХ 30 дней (cpoInputs.views), не от накопителя.
      const inputByNcn = new Map(cpoInputs.map((i) => [i.normalizedClusterName, i]));
      const spendByNcn = new Map(deltas.map((d) => [d.normalizedClusterName, d.spend]));
      for (const s of states) {
        const inp = inputByNcn.get(s.normalizedClusterName);
        const ordered = inp ? Math.max(inp.shks ?? inp.ordersRk, inp.ordersJam) : 0;
        const bidCap = inp
          ? computeBidCap(
              maxCpo,
              computeClusterCr({
                accruedOrdersRk: inp.shks ?? inp.ordersRk,
                accruedViews: inp.views,
              }),
            )
          : null;
        rows.push({
          advertId,
          normalizedClusterName: s.normalizedClusterName,
          state: s.state,
          drrHeld: s.drrHeld,
          orderedAccrued: ordered,
          ydaySpend: spendByNcn.get(s.normalizedClusterName) ?? 0,
          bidCap,
        });
      }
    }
    return rows;
  }
}
