import { describe, expect, it } from "vitest";

import { computeBidCap, computeClusterCr, CR_VIEWS_FLOOR } from "./product-cluster-bid";

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
