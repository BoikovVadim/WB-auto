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

// ── Этап 3: позиционный регулятор ставки ───────────────────────────────────────

/**
 * Граница: позиция ≤ этой → пробуем ПОНИЖАТЬ (держимся в топе, ищем дешевле), > → ПОВЫШАЕМ.
 * По решению пользователя: на 5 месте пробуем понижать (рынок меняется — ночью дешевле).
 */
export const BID_DOWN_AT_OR_ABOVE = 5;

export interface BidEngineParams {
  /** Минимальная ставка CPM (₽). */
  minBid: number;
  /** Жёсткий максимум ставки WB (₽) — clamp сверху вместе с bid_cap. */
  maxWbBid: number;
  /**
   * Шаг ставки за один круг = доля от МИНИМАЛЬНОЙ ставки (0.1 = 10% от minBid).
   * ФИКСИРОВАННЫЙ абсолютный шаг, симметричный вверх/вниз — никаких прыжков на потолок.
   */
  stepFrac: number;
}

export interface DesiredBidInput {
  /** Позиция С РЕКЛАМОЙ (зонд); null — не найдена/за пределом глубины. */
  position: number | null;
  /** Текущая ставка кластера (₽). */
  currentBid: number;
  /** Потолок окупаемости (Макс СРО × 1000 × CR); null/≤0 — регулировать не на чем. */
  bidCap: number | null;
}

export interface DesiredBidResult {
  /** Новая ставка (₽), уже приведённая clamp(minBid, min(bidCap, maxWbBid)). */
  bid: number;
  /** Причина — для телеметрии/наблюдения. */
  reason: "up" | "down" | "frozen" | "at_cap" | "at_min";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Желаемая ставка по позиции С РЕКЛАМОЙ (этап 3). БЕЗ удержания — каждый круг двигаем ставку
 * фиксированным шагом (10% от минимальной ставки), рынок меняется постоянно:
 *  - нет позиции → заморозка (зонд не дал данных — R3);
 *  - P ≤ 5 (в топе/коридоре) → ПОНИЖАЕМ на шаг (пробуем платить меньше; если позиция
 *    удержится — следующий круг ещё понизит; просядем — следующий круг поднимет);
 *  - P > 5 (выпали) → ПОВЫШАЕМ на шаг.
 * Шаг фиксированный, симметричный. Итог всегда clamp(minBid, min(bidCap, maxWbBid)):
 * вверх упираемся в потолок окупаемости, вниз — в минимальную ставку.
 */
export function computeDesiredBid(
  input: DesiredBidInput,
  params: BidEngineParams,
): DesiredBidResult {
  const { minBid, maxWbBid, stepFrac } = params;
  const cap = input.bidCap != null && input.bidCap > 0 ? input.bidCap : minBid;
  const hi = Math.max(minBid, Math.min(cap, maxWbBid));
  const cur = clamp(input.currentBid, minBid, hi);
  const step = minBid * stepFrac;

  // Нет позиции — не дёргаем ставку (R3: замораживаем как есть).
  if (input.position == null) return { bid: cur, reason: "frozen" };

  // В топе/коридоре (P ≤ 5) — понижаем на шаг (ищем минимально достаточную ставку).
  if (input.position <= BID_DOWN_AT_OR_ABOVE) {
    if (cur <= minBid) return { bid: minBid, reason: "at_min" };
    return { bid: clamp(cur - step, minBid, hi), reason: "down" };
  }

  // Выпали (P > 5) — повышаем на шаг.
  if (cur >= hi) return { bid: hi, reason: "at_cap" };
  return { bid: clamp(cur + step, minBid, hi), reason: "up" };
}

/** Кластер убыточен даже на минимуме (bid_cap < minBid) → кандидат на отключение по конверсии. */
export function isUnprofitableAtMin(bidCap: number | null, minBid: number): boolean {
  return bidCap != null && bidCap < minBid;
}
