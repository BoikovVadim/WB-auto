import { priceBucket } from "./wb-clusters.accrual.bucket";
import type { WbClustersRepository } from "./wb-clusters.repository";

/**
 * «Живой» накопитель: отстоявшаяся ценовая корзина (накоплено ДО вчера) + overlay СЕГОДНЯШНЕГО
 * дня. Даёт значения, освежающиеся каждые 10 минут (вместе с синком расхода/заказов), из которых
 * пересчитывается потолок ставки. Двойного счёта нет: дневной крон фолдит «вчера» (last_accrued
 * = вчера), а сегодняшние дельты в корзину ещё не внесены — overlay их добавляет на лету.
 *
 * Сегодняшний JAM обычно ещё не выгружен (синкается ночью за «вчера») → overlay по JAM ≈ 0;
 * это нормально — внутри дня живут расход/заказы РК/показы.
 */
export interface LiveBucketAccrual {
  accruedSpend: number;
  accruedOrdersRk: number;
  accruedOrdersJam: number;
  accruedViews: number;
}

type LiveAccrualRepo = Pick<
  WbClustersRepository,
  "getMskToday" | "getProductEffectivePriceForDate" | "getAccrualBuckets" | "getDailyClusterDeltas"
>;

export async function loadLiveBucketAccrual(
  repo: LiveAccrualRepo,
  advertId: number,
  nmId: number,
): Promise<Map<string, LiveBucketAccrual>> {
  const today = await repo.getMskToday();
  const price = await repo.getProductEffectivePriceForDate(nmId, today);
  const bucket = priceBucket(price);
  const [settled, todayDeltas] = await Promise.all([
    repo.getAccrualBuckets(advertId, nmId),
    repo.getDailyClusterDeltas(advertId, nmId, today),
  ]);

  const map = new Map<string, LiveBucketAccrual>();
  for (const r of settled) {
    if (r.priceBucket !== bucket) continue;
    map.set(r.normalizedClusterName, {
      accruedSpend: r.accruedSpend,
      accruedOrdersRk: r.accruedOrdersRk,
      accruedOrdersJam: r.accruedOrdersJam,
      accruedViews: r.accruedViews,
    });
  }
  for (const d of todayDeltas) {
    const cur = map.get(d.normalizedClusterName) ?? {
      accruedSpend: 0,
      accruedOrdersRk: 0,
      accruedOrdersJam: 0,
      accruedViews: 0,
    };
    map.set(d.normalizedClusterName, {
      accruedSpend: cur.accruedSpend + d.spend,
      accruedOrdersRk: cur.accruedOrdersRk + d.ordersRk,
      accruedOrdersJam: cur.accruedOrdersJam + d.ordersJam,
      accruedViews: cur.accruedViews + d.views,
    });
  }
  return map;
}
