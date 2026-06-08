import { computeClusterCr } from "./product-cluster-bid";
import { loadLiveBucketAccrual } from "./wb-clusters-accrual-live";
import type { WbClustersRepository } from "./wb-clusters.repository";
import type { ProductAdvertisingWorkspaceClusterRow } from "./wb-clusters.types";

/**
 * Подмешивание накопленных счётчиков ТЕКУЩЕЙ ценовой корзины (входы движка решений v2) в строки
 * таблицы кластеров — чтобы в UI было видно, ПОЧЕМУ движок включил/исключил кластер. Берётся
 * «живой» накопитель (отстоявшаяся корзина + сегодняшний overlay), поэтому числа освежаются
 * каждые 10 минут вместе с движком. Формулы согласованы с движком: заказы = max(РК, JAM); СРО =
 * расход/заказы (или сам расход при 0 заказов, как effectiveCpo); CR = computeClusterCr (тот же,
 * что у потолка ставки) в процентах.
 */

type AccrualRepo = Pick<
  WbClustersRepository,
  "getMskToday" | "getProductEffectivePriceForDate" | "getAccrualBuckets" | "getDailyClusterDeltas"
>;

export interface ClusterAccrualForRow {
  accruedSpend: number;
  accruedOrders: number;
  accruedViews: number;
  accruedCpo: number | null;
  accruedCr: number | null;
}

/** Живые накопления текущей корзины кампании, ключ — нормализованное имя кластера. */
export async function loadCurrentBucketAccrualForRows(
  repo: AccrualRepo,
  advertId: number,
  nmId: number,
): Promise<Map<string, ClusterAccrualForRow>> {
  const live = await loadLiveBucketAccrual(repo, advertId, nmId);

  const map = new Map<string, ClusterAccrualForRow>();
  for (const [ncn, r] of live) {
    const orders = Math.max(r.accruedOrdersRk, r.accruedOrdersJam);
    const accruedCpo =
      orders > 0 ? r.accruedSpend / orders : r.accruedSpend > 0 ? r.accruedSpend : null;
    const cr = computeClusterCr({
      accruedOrdersRk: r.accruedOrdersRk,
      accruedOrdersJam: r.accruedOrdersJam,
      accruedViews: r.accruedViews,
    });
    map.set(ncn, {
      accruedSpend: r.accruedSpend,
      accruedOrders: orders,
      accruedViews: r.accruedViews,
      accruedCpo,
      // CR (доля) → проценты для UI, как ctr. null только если нет ни заказов, ни показов.
      accruedCr: orders > 0 || r.accruedViews > 0 ? cr * 100 : null,
    });
  }
  return map;
}

/** Подмешивает накопления в строки кластеров по нормализованному имени (trim+lower, ru). */
export function mergeAccrualIntoClusterRows(
  rows: ProductAdvertisingWorkspaceClusterRow[],
  accrualByCluster: Map<string, ClusterAccrualForRow>,
): ProductAdvertisingWorkspaceClusterRow[] {
  return rows.map((row) => {
    const acc = accrualByCluster.get(row.clusterName.trim().toLocaleLowerCase("ru"));
    return {
      ...row,
      accruedSpend: acc?.accruedSpend ?? null,
      accruedOrders: acc?.accruedOrders ?? null,
      accruedViews: acc?.accruedViews ?? null,
      accruedCpo: acc?.accruedCpo ?? null,
      accruedCr: acc?.accruedCr ?? null,
    };
  });
}
