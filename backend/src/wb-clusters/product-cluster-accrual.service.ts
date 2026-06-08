import { Injectable, Logger } from "@nestjs/common";

import { priceBucket } from "./wb-clusters.accrual.bucket";
import { loadLiveBucketAccrual } from "./wb-clusters-accrual-live";
import { WbClustersRepository } from "./wb-clusters.repository";

/** Накопленные счётчики кластера из текущей ценовой корзины (для правила v2). */
export interface ClusterBucketAccrual {
  accruedSpend: number;
  accruedOrdersRk: number;
  accruedOrdersJam: number;
  /** Накопленные показы — знаменатель CR для ставочного движка. */
  accruedViews: number;
}

/**
 * Накопительные счётчики кластеров по ценовым корзинам (этап 1A новой логики v2). Копит
 * ВЧЕРАШНИЙ день в корзину товара и отдаёт накопления текущей корзины движку решений.
 * Вынесено из ProductClusterAutomationService по ответственности (аккумулятор ≠ оркестрация).
 * См. wb-clusters.repository.accrual.ts и память project-cluster-ad-strategy.
 */
@Injectable()
export class ProductClusterAccrualService {
  private readonly logger = new Logger("ProductClusterAccrual");

  constructor(private readonly repository: WbClustersRepository) {}

  /**
   * Ежедневный аккумулятор. Для каждой кампании с включённой автоматикой прибавляет ВЧЕРАШНИЙ
   * день (расход/заказы РК из дневной статистики + подневные JAM-заказы) в ценовую корзину
   * товара (priceBucket по цене со скидкой за тот день). Идемпотентен: повторный прогон не
   * задвоит день (guard last_accrued_date).
   */
  async accrueYesterdayForAll(): Promise<void> {
    const date = await this.repository.getMskYesterday();
    const enabled = await this.repository.listEnabledAutomations();
    let ok = 0;
    for (const a of enabled) {
      try {
        const deltas = await this.repository.getDailyClusterDeltas(a.advertId, a.nmId, date);
        if (deltas.length === 0) continue;
        const price = await this.repository.getProductEffectivePriceForDate(a.nmId, date);
        await this.repository.accrueDailyDeltas({
          advertId: a.advertId,
          nmId: a.nmId,
          priceBucket: priceBucket(price),
          basePrice: price,
          date,
          deltas,
        });
        ok++;
      } catch (err) {
        this.logger.warn(`accrue ${a.advertId}/${a.nmId}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`accrue ${date}: ${ok}/${enabled.length} кампаний прибавлено`);
  }

  /**
   * Накопления кластеров из ТЕКУЩЕЙ ценовой корзины (по цене последнего накопленного дня).
   * Возвращает Map по нормализованному имени кластера для правила v2. Корзина определяется
   * ценой за вчера — тем же priceBucket, по которому раскладывал аккумулятор.
   */
  async loadCurrentBucketAccrual(
    advertId: number,
    nmId: number,
  ): Promise<Map<string, ClusterBucketAccrual>> {
    const date = await this.repository.getMskYesterday();
    const price = await this.repository.getProductEffectivePriceForDate(nmId, date);
    const bucket = priceBucket(price);
    const rows = await this.repository.getAccrualBuckets(advertId, nmId);
    const map = new Map<string, ClusterBucketAccrual>();
    for (const r of rows) {
      if (r.priceBucket !== bucket) continue;
      map.set(r.normalizedClusterName, {
        accruedSpend: r.accruedSpend,
        accruedOrdersRk: r.accruedOrdersRk,
        accruedOrdersJam: r.accruedOrdersJam,
        accruedViews: r.accruedViews,
      });
    }
    return map;
  }

  /**
   * ЖИВОЙ накопитель текущей корзины: отстоявшаяся корзина (до вчера) + overlay сегодняшнего дня.
   * Освежается каждые 10 минут (с синком расхода/заказов) → из него движок пересчитывает решения
   * и потолок ставки на лету. Двойного счёта нет (сегодня в корзину ещё не внесён). См.
   * wb-clusters-accrual-live.ts.
   */
  async loadCurrentBucketAccrualLive(
    advertId: number,
    nmId: number,
  ): Promise<Map<string, ClusterBucketAccrual>> {
    return loadLiveBucketAccrual(this.repository, advertId, nmId);
  }
}
