import { describe, expect, it } from "vitest";

import {
  computeBidCap,
  computeClusterCr,
  computeDesiredBid,
  isUnprofitableAtMin,
  parseMinSearchBid,
  type BidEngineParams,
  CR_VIEWS_FLOOR,
} from "./product-cluster-bid";

const PARAMS: BidEngineParams = { minBid: 100, maxWbBid: 5000, coarsePct: 0.1, fineStep: 10 };

describe("computeClusterCr (max(РК,JAM), пол 100 показов)", () => {
  it("CR = max(РК,JAM) / показы при показах выше пола", () => {
    expect(computeClusterCr({ accruedOrdersRk: 10, accruedOrdersJam: 4, accruedViews: 1000 })).toBeCloseTo(0.01, 6);
  });

  it("берёт JAM, если их больше (кластер с halo-заказами тоже считается)", () => {
    expect(computeClusterCr({ accruedOrdersRk: 2, accruedOrdersJam: 9, accruedViews: 900 })).toBeCloseTo(0.01, 6);
  });

  it("пол 100 показов гасит шум малых кластеров", () => {
    expect(computeClusterCr({ accruedOrdersRk: 0, accruedOrdersJam: 2, accruedViews: 3 })).toBeCloseTo(2 / CR_VIEWS_FLOOR, 6);
  });

  it("нет заказов вовсе → CR = 0", () => {
    expect(computeClusterCr({ accruedOrdersRk: 0, accruedOrdersJam: 0, accruedViews: 5000 })).toBe(0);
  });
});

describe("computeBidCap", () => {
  it("bid_cap = Макс СРО × 1000 × CR", () => {
    // Макс СРО 50 ₽, CR 1% → 50 × 1000 × 0.01 = 500
    expect(computeBidCap(50, 0.01)).toBeCloseTo(500, 6);
  });

  it("CR=0 (бесзаказный) → bid_cap = 0 (оседает на минимум/отключение)", () => {
    expect(computeBidCap(50, 0)).toBe(0);
  });

  it("нет Макс СРО → null (регулировать не на чем)", () => {
    expect(computeBidCap(null, 0.01)).toBeNull();
    expect(computeBidCap(0, 0.01)).toBeNull();
  });

  it("высокая CR → высокий потолок", () => {
    // Макс СРО 50, CR 5% → 2500
    expect(computeBidCap(50, 0.05)).toBeCloseTo(2500, 6);
  });
});

describe("computeDesiredBid (P>4 → +10% от мин. ставки, P≤4 → −10₽)", () => {
  it("нет позиции → заморозка", () => {
    const r = computeDesiredBid({ position: null, currentBid: 800, bidCap: 5000 }, PARAMS);
    expect(r.reason).toBe("frozen");
    expect(r.bid).toBe(800);
  });

  it("P=5 (хуже цели) → +фикс-шаг 10% от мин. ставки", () => {
    const r = computeDesiredBid({ position: 5, currentBid: 500, bidCap: 5000 }, PARAMS);
    expect(r.reason).toBe("up");
    expect(r.bid).toBe(510); // 500 + round(100 × 0.10) = 500 + 10
  });

  it("P=20 (далеко) → тот же фикс-шаг от мин. ставки", () => {
    const r = computeDesiredBid({ position: 20, currentBid: 370, bidCap: 5000 }, PARAMS);
    expect(r.reason).toBe("up");
    expect(r.bid).toBe(380); // 370 + 10
  });

  it("P=4 (достигли топ-4) → −10₽", () => {
    const r = computeDesiredBid({ position: 4, currentBid: 800, bidCap: 5000 }, PARAMS);
    expect(r.reason).toBe("down");
    expect(r.bid).toBe(790);
  });

  it("P=2 на минимуме → at_min", () => {
    const r = computeDesiredBid({ position: 2, currentBid: 100, bidCap: 5000 }, PARAMS);
    expect(r.reason).toBe("at_min");
    expect(r.bid).toBe(100);
  });

  it("упёрлись в потолок (P>4, cur≥hi) → стоим (at_cap)", () => {
    const r = computeDesiredBid({ position: 8, currentBid: 2000, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("at_cap");
    expect(r.bid).toBe(2000);
  });

  it("подъём не прыгает на потолок — только фикс-шаг за круг", () => {
    const r = computeDesiredBid({ position: 159, currentBid: 370, bidCap: 5000 }, PARAMS);
    expect(r.bid).toBe(380); // 370 + 10, не прыжок на потолок
  });

  it("подъём clamp по min(bidCap, maxWbBid)", () => {
    const r = computeDesiredBid({ position: 8, currentBid: 4995, bidCap: 9000 }, PARAMS);
    expect(r.bid).toBe(PARAMS.maxWbBid);
  });
});

describe("parseMinSearchBid (ответ WB /bids/min)", () => {
  const resp = { bids: [{ bids: [{ currency: "RUB", type: "search", value: 37000 }], nm_id: 198676662 }] };

  it("берёт search-минимум нужного nm_id в рублях (копейки/100)", () => {
    expect(parseMinSearchBid(resp, 198676662)).toBe(370);
  });

  it("другой nm_id → null", () => {
    expect(parseMinSearchBid(resp, 999)).toBeNull();
  });

  it("мусорный ответ → null", () => {
    expect(parseMinSearchBid(null, 1)).toBeNull();
    expect(parseMinSearchBid({}, 1)).toBeNull();
    expect(parseMinSearchBid({ bids: "x" }, 1)).toBeNull();
  });

  it("нет search-типа → null", () => {
    const r = { bids: [{ bids: [{ type: "recommendations", value: 5000 }], nm_id: 1 }] };
    expect(parseMinSearchBid(r, 1)).toBeNull();
  });
});

describe("isUnprofitableAtMin", () => {
  it("bid_cap < мин → убыточен (кандидат на отключение)", () => {
    expect(isUnprofitableAtMin(50, 100)).toBe(true);
  });
  it("bid_cap ≥ мин → ок", () => {
    expect(isUnprofitableAtMin(150, 100)).toBe(false);
  });
  it("bid_cap null → не убыточен (нет данных)", () => {
    expect(isUnprofitableAtMin(null, 100)).toBe(false);
  });
});
