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

/** Цель — топ-4 (коридор 4-5): P>5 поднимаем, P≤4 пробуем снизить, P=5 держим. */
export const BID_TARGET_POSITION = 4;
export const BID_CORRIDOR_TOP = 5;

export interface BidEngineParams {
  /** Минимальная ставка CPM (₽). */
  minBid: number;
  /** Жёсткий максимум ставки WB (₽) — clamp сверху вместе с bid_cap. */
  maxWbBid: number;
  /** Агрессивность подъёма: доля пути к bid_cap = clamp01(kUp × (P − 4)). */
  kUp: number;
  /** Осторожность probe-down: доля пути к minBid за один шаг вниз. */
  stepDown: number;
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
  reason: "up" | "down" | "hold" | "frozen" | "at_cap" | "at_min";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Желаемая ставка по позиции С РЕКЛАМОЙ (этап 3). Цель — топ-4 (коридор 4-5).
 *  - нет позиции → замораживаем ставку как есть (зонд не дал данных — R3);
 *  - P > 5 (выпал) → поднимаем долей пути к bid_cap ∝ (P−4), вверх агрессивно;
 *  - P ≤ 4 (в топе) → probe-down: осторожно снижаем, ищем минимально достаточную;
 *  - P = 5 (коридор) → держим.
 * Итог всегда clamp(minBid, min(bidCap, maxWbBid)). Если потолок ≤ minBid (CR слишком
 * низкая) — это сигнал отключения (решается в сервисе), здесь возвращаем minBid/at_min.
 */
export function computeDesiredBid(
  input: DesiredBidInput,
  params: BidEngineParams,
): DesiredBidResult {
  const { minBid, maxWbBid, kUp, stepDown } = params;
  const cap = input.bidCap != null && input.bidCap > 0 ? input.bidCap : minBid;
  const hi = Math.max(minBid, Math.min(cap, maxWbBid));
  const cur = clamp(input.currentBid, minBid, hi);

  // Нет позиции — не дёргаем ставку (R3: ставки замораживаются как есть).
  if (input.position == null) return { bid: cur, reason: "frozen" };

  // В топе — probe-down (раз держимся, пробуем платить меньше).
  if (input.position <= BID_TARGET_POSITION) {
    if (cur <= minBid) return { bid: minBid, reason: "at_min" };
    const next = clamp(cur - (cur - minBid) * stepDown, minBid, hi);
    return { bid: next, reason: "down" };
  }

  // Коридор (ровно 5) — держим.
  if (input.position <= BID_CORRIDOR_TOP) return { bid: cur, reason: "hold" };

  // Выпали (P > 5) — поднимаем долей пути к потолку ∝ (P−4), агрессивно.
  if (cur >= hi) return { bid: hi, reason: "at_cap" };
  const frac = clamp(kUp * (input.position - BID_TARGET_POSITION), 0, 1);
  const next = clamp(cur + (hi - cur) * frac, minBid, hi);
  return { bid: next, reason: "up" };
}

/** Кластер убыточен даже на минимуме (bid_cap < minBid) → кандидат на отключение по конверсии. */
export function isUnprofitableAtMin(bidCap: number | null, minBid: number): boolean {
  return bidCap != null && bidCap < minBid;
}
