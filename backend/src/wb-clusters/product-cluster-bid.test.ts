import { describe, expect, it } from "vitest";

import {
  computeBidCap,
  computeClusterCr,
  computeDesiredBid,
  isUnprofitableAtMin,
  type BidEngineParams,
  CR_VIEWS_FLOOR,
} from "./product-cluster-bid";

const PARAMS: BidEngineParams = { minBid: 100, maxWbBid: 5000, kUp: 0.34, stepDown: 0.1 };

describe("computeClusterCr", () => {
  it("CR = max(РК,JAM) / показы при показах выше пола", () => {
    expect(
      computeClusterCr({ accruedOrdersRk: 10, accruedOrdersJam: 4, accruedViews: 1000 }),
    ).toBeCloseTo(0.01, 6); // max(10,4)=10 / 1000
  });

  it("берёт max заказов РК/JAM (risk-on)", () => {
    expect(
      computeClusterCr({ accruedOrdersRk: 2, accruedOrdersJam: 9, accruedViews: 900 }),
    ).toBeCloseTo(0.01, 6); // max(2,9)=9 / 900
  });

  it("пол 100 показов гасит шум малых кластеров", () => {
    // 2 заказа на 3 показах: без пола CR=0.667, с полом = 2/100 = 0.02
    expect(
      computeClusterCr({ accruedOrdersRk: 2, accruedOrdersJam: 0, accruedViews: 3 }),
    ).toBeCloseTo(2 / CR_VIEWS_FLOOR, 6);
  });

  it("нет заказов → CR = 0", () => {
    expect(
      computeClusterCr({ accruedOrdersRk: 0, accruedOrdersJam: 0, accruedViews: 5000 }),
    ).toBe(0);
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

describe("computeDesiredBid (позиционный регулятор)", () => {
  it("нет позиции → заморозка (ставка не меняется)", () => {
    const r = computeDesiredBid({ position: null, currentBid: 800, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("frozen");
    expect(r.bid).toBe(800);
  });

  it("P=5 (коридор) → держим", () => {
    const r = computeDesiredBid({ position: 5, currentBid: 800, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("hold");
    expect(r.bid).toBe(800);
  });

  it("P=2 (в топе) → probe-down, ставка ниже текущей но не ниже минимума", () => {
    const r = computeDesiredBid({ position: 2, currentBid: 800, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("down");
    expect(r.bid).toBeLessThan(800);
    expect(r.bid).toBeGreaterThanOrEqual(PARAMS.minBid);
    // шаг 10% пути к min: 800 - (800-100)*0.1 = 730
    expect(r.bid).toBeCloseTo(730, 6);
  });

  it("P=2 уже на минимуме → at_min", () => {
    const r = computeDesiredBid({ position: 2, currentBid: 100, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("at_min");
    expect(r.bid).toBe(100);
  });

  it("P=8 (выпал) → поднимаем долей пути к потолку, агрессивно", () => {
    const r = computeDesiredBid({ position: 8, currentBid: 500, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("up");
    // frac = clamp(0.34*(8-4),0,1)=1 → весь путь к hi=min(2000,5000)=2000
    expect(r.bid).toBeCloseTo(2000, 6);
  });

  it("P=6 (чуть выпал) → частичный подъём (frac<1)", () => {
    const r = computeDesiredBid({ position: 6, currentBid: 500, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("up");
    // frac = 0.34*2 = 0.68 → 500 + (2000-500)*0.68 = 1520
    expect(r.bid).toBeCloseTo(1520, 6);
  });

  it("P=8 но уже на потолке → at_cap (стоим, ждём halo)", () => {
    const r = computeDesiredBid({ position: 8, currentBid: 2000, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("at_cap");
    expect(r.bid).toBe(2000);
  });

  it("clamp сверху по min(bidCap, maxWbBid): bidCap выше maxWb → режет maxWb", () => {
    const r = computeDesiredBid({ position: 8, currentBid: 4000, bidCap: 9000 }, PARAMS);
    expect(r.bid).toBeLessThanOrEqual(PARAMS.maxWbBid);
  });

  it("bidCap ниже минимума → потолок = minBid, ставка садится на минимум", () => {
    const r = computeDesiredBid({ position: 8, currentBid: 300, bidCap: 50 }, PARAMS);
    expect(r.bid).toBe(PARAMS.minBid);
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
