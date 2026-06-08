/**
 * Этап 2 ставочного движка: потолок ставки CPM кластера (bid_cap).
 *
 * Чистые функции, без побочных эффектов и обращений к БД — легко тестируются и переиспользуются
 * (evaluateOne для preview-наблюдения, позиционный регулятор на этапе 3). См. стратегию
 * docs/cluster-ad-strategy.md и память project-cluster-ad-strategy(-summary).
 *
 * Вывод bid_cap: ставка CPM — цена за 1000 показов. Расход = bid × показы / 1000;
 * заказы = CR × показы. CPO = расход / заказы = bid / (1000 × CR). Чтобы CPO ≤ Макс СРО:
 *   bid ≤ Макс СРО × 1000 × CR  ⟹  bid_cap = Макс СРО × 1000 × CR.
 */

/** Пол показов: гасит шум малых кластеров (мало показов → CR не взлетает до абсурда). */
export const CR_VIEWS_FLOOR = 100;

/**
 * CR (показ→заказ) = max(заказы РК, JAM) / max(показы, 100). Заказы — risk-on max(РК,JAM)
 * (единообразно со всей стратегией). Пол 100 показов не даёт паре заказов на 3 показах
 * раздуть CR. Возвращает долю (не проценты): 0.0123 = 1.23 %.
 */
export function computeClusterCr(input: {
  accruedOrdersRk: number;
  accruedOrdersJam: number;
  accruedViews: number;
}): number {
  const orders = Math.max(input.accruedOrdersRk, input.accruedOrdersJam);
  if (orders <= 0) return 0;
  const views = Math.max(input.accruedViews, CR_VIEWS_FLOOR);
  return orders / views;
}

/**
 * Потолок ставки CPM: bid_cap = Макс СРО × 1000 × CR. Самонастройка окупаемости — показы без
 * заказов роняют CR → bid_cap → к минимуму; заказ восстанавливает потолок. Возвращает null,
 * если порог не определён (нет Макс СРО) — регулировать не на чем.
 */
export function computeBidCap(maxCpo: number | null, cr: number): number | null {
  if (maxCpo == null || maxCpo <= 0) return null;
  return maxCpo * 1000 * cr;
}
