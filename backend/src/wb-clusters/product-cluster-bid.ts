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
 * CR (рекламный показ→заказ) = РЕКЛАМНЫЕ заказы / рекламные показы, пол 100 показов от шума.
 * ВАЖНО: числитель — ТОЛЬКО рекламные заказы (РК), БЕЗ JAM-органики. Потолок ставки — про
 * окупаемость рекламного показа, поэтому и конверсия рекламная; max(РК,JAM) раздувал бы CR
 * (органические заказы на рекламные показы). max(РК,JAM) остаётся в CPO для вкл/выкл, не здесь.
 * Возвращает долю (не проценты): 0.0123 = 1.23 %.
 */
export function computeClusterCr(input: {
  accruedOrdersRk: number;
  accruedViews: number;
}): number {
  if (input.accruedOrdersRk <= 0) return 0;
  const views = Math.max(input.accruedViews, CR_VIEWS_FLOOR);
  return input.accruedOrdersRk / views;
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

/** Целевая позиция — топ-4. Хуже → разгон вверх; в топе → точная подстройка вниз. */
export const BID_TARGET_POSITION = 4;

export interface BidEngineParams {
  /** Минимальная ставка CPM (₽). */
  minBid: number;
  /** Жёсткий максимум ставки WB (₽) — clamp сверху вместе с bid_cap. */
  maxWbBid: number;
  /**
   * РАЗГОН: пока не добрались до топ-4 — поднимаем на эту долю от ТЕКУЩЕЙ ставки за круг
   * (0.10 = +10%). Быстро доехать до цели.
   */
  coarsePct: number;
  /**
   * ТОЧНАЯ подстройка: в топ-4 снижаем на этот фикс-шаг (₽) за круг — ищем минимально
   * достаточную ставку мелкими шагами.
   */
  fineStep: number;
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
 * Желаемая ставка по позиции С РЕКЛАМОЙ (этап 3):
 *  - нет позиции → заморозка (зонд не дал данных — R3);
 *  - P > 4 (хуже цели) → ПОДНИМАЕМ на coarsePct% от текущей ставки (разгон к топ-4);
 *  - P ≤ 4 (достигли топ-4) → СПУСКАЕМ на fineStep ₽ за круг (ищем минимально достаточную);
 *  - на потолке окупаемости (cur ≥ hi, P > 4) → стоим на нём (выше платить нерентабельно).
 * Итог всегда clamp(minBid, min(bidCap, maxWbBid)).
 */
export function computeDesiredBid(
  input: DesiredBidInput,
  params: BidEngineParams,
): DesiredBidResult {
  const { minBid, maxWbBid, coarsePct, fineStep } = params;
  const cap = input.bidCap != null && input.bidCap > 0 ? input.bidCap : minBid;
  const hi = Math.max(minBid, Math.min(cap, maxWbBid));
  const cur = clamp(input.currentBid, minBid, hi);

  // Нет позиции — не дёргаем ставку (R3: замораживаем как есть).
  if (input.position == null) return { bid: cur, reason: "frozen" };

  // Достигли топ-4 — спускаем по fineStep ₽ (ищем минимально достаточную ставку).
  if (input.position <= BID_TARGET_POSITION) {
    if (cur <= minBid) return { bid: minBid, reason: "at_min" };
    return { bid: clamp(cur - fineStep, minBid, hi), reason: "down" };
  }

  // Хуже цели — поднимаем на coarsePct% от текущей. На потолке окупаемости стоим.
  if (cur >= hi) return { bid: hi, reason: "at_cap" };
  return { bid: clamp(cur * (1 + coarsePct), minBid, hi), reason: "up" };
}

/** Кластер убыточен даже на минимуме (bid_cap < minBid) → кандидат на отключение по конверсии. */
export function isUnprofitableAtMin(bidCap: number | null, minBid: number): boolean {
  return bidCap != null && bidCap < minBid;
}

/**
 * Парсит минимальную ставку поиска (₽) из ответа WB /api/advert/v1/bids/min для товара.
 * Формат: { bids: [{ nm_id, bids: [{ currency, type, value }] }] }, value — в КОПЕЙКАХ.
 * Возвращает рубли (value/100) для type='search' нужного nm_id; null если не найдено.
 */
export function parseMinSearchBid(response: unknown, nmId: number): number | null {
  if (typeof response !== "object" || response === null) return null;
  const outer = (response as { bids?: unknown }).bids;
  if (!Array.isArray(outer)) return null;
  for (const entry of outer) {
    if (typeof entry !== "object" || entry === null) continue;
    if ((entry as { nm_id?: unknown }).nm_id !== nmId) continue;
    const inner = (entry as { bids?: unknown }).bids;
    if (!Array.isArray(inner)) return null;
    for (const b of inner) {
      if (typeof b !== "object" || b === null) continue;
      if ((b as { type?: unknown }).type !== "search") continue;
      const v = (b as { value?: unknown }).value;
      if (typeof v === "number" && v > 0) return v / 100;
    }
  }
  return null;
}
