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

const PARAMS: BidEngineParams = { minBid: 100, maxWbBid: 5000, stepFrac: 0.1 }; // шаг = 10₽

describe("computeClusterCr (чистый рекламный CR, без JAM)", () => {
  it("CR = рекламные заказы / показы при показах выше пола", () => {
    expect(computeClusterCr({ accruedOrdersRk: 10, accruedViews: 1000 })).toBeCloseTo(0.01, 6);
  });

  it("JAM не участвует — только рекламные заказы (не раздуваем органикой)", () => {
    // даже если органики много, CR от рекламных заказов: 2/1000 = 0.2%
    expect(computeClusterCr({ accruedOrdersRk: 2, accruedViews: 1000 })).toBeCloseTo(0.002, 6);
  });

  it("пол 100 показов гасит шум малых кластеров", () => {
    expect(computeClusterCr({ accruedOrdersRk: 2, accruedViews: 3 })).toBeCloseTo(2 / CR_VIEWS_FLOOR, 6);
  });

  it("нет рекламных заказов → CR = 0", () => {
    expect(computeClusterCr({ accruedOrdersRk: 0, accruedViews: 5000 })).toBe(0);
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

describe("computeDesiredBid (фиксированный шаг, без удержания)", () => {
  it("нет позиции → заморозка (ставка не меняется)", () => {
    const r = computeDesiredBid({ position: null, currentBid: 800, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("frozen");
    expect(r.bid).toBe(800);
  });

  it("P=5 → ПОНИЖАЕМ на фикс-шаг (пробуем дешевле, рынок меняется)", () => {
    const r = computeDesiredBid({ position: 5, currentBid: 800, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("down");
    expect(r.bid).toBe(790); // 800 − 10
  });

  it("P=2 (в топе) → понижаем на фикс-шаг", () => {
    const r = computeDesiredBid({ position: 2, currentBid: 800, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("down");
    expect(r.bid).toBe(790); // 800 − 10
  });

  it("P=2 на минимуме → at_min (ниже не идём)", () => {
    const r = computeDesiredBid({ position: 2, currentBid: 100, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("at_min");
    expect(r.bid).toBe(100);
  });

  it("P=6 (выпали) → ПОВЫШАЕМ на фикс-шаг (никаких прыжков)", () => {
    const r = computeDesiredBid({ position: 6, currentBid: 500, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("up");
    expect(r.bid).toBe(510); // 500 + 10
  });

  it("P=159 (глубоко выпали) → всё равно только +шаг (фикс, не прыжок к потолку)", () => {
    const r = computeDesiredBid({ position: 159, currentBid: 100, bidCap: 2833 }, PARAMS);
    expect(r.reason).toBe("up");
    expect(r.bid).toBe(110); // 100 + 10, а НЕ 2833
  });

  it("P=8 на потолке → at_cap", () => {
    const r = computeDesiredBid({ position: 8, currentBid: 2000, bidCap: 2000 }, PARAMS);
    expect(r.reason).toBe("at_cap");
    expect(r.bid).toBe(2000);
  });

  it("шаг симметричен: вверх +10 и вниз −10 одинаковы", () => {
    const up = computeDesiredBid({ position: 8, currentBid: 500, bidCap: 2000 }, PARAMS);
    const down = computeDesiredBid({ position: 3, currentBid: 500, bidCap: 2000 }, PARAMS);
    expect(up.bid - 500).toBe(10);
    expect(500 - down.bid).toBe(10);
  });

  it("clamp сверху по min(bidCap, maxWbBid)", () => {
    const r = computeDesiredBid({ position: 8, currentBid: 5000, bidCap: 9000 }, PARAMS);
    expect(r.bid).toBe(PARAMS.maxWbBid); // at_cap на maxWb
  });

  it("bidCap ниже минимума → потолок = minBid", () => {
    const r = computeDesiredBid({ position: 8, currentBid: 300, bidCap: 50 }, PARAMS);
    expect(r.bid).toBe(PARAMS.minBid);
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
