import { describe, expect, it } from "vitest";

import {
  partitionPrecomputeByQuerySize,
  describeSkippedMonsters,
} from "./precompute-monster-gate";

describe("partitionPrecomputeByQuerySize", () => {
  it("оставляет товары на/под порогом, пропускает монстров строго выше порога", () => {
    const counts = new Map<number, number>([
      [1, 10_000],
      [2, 80_000], // ровно порог — НЕ монстр
      [3, 80_001], // на 1 выше — монстр
      [4, 216_560],
    ]);
    const { eligible, skipped } = partitionPrecomputeByQuerySize([1, 2, 3, 4], counts, 80_000);
    expect(eligible).toEqual([1, 2]);
    expect(skipped.map((s) => s.nmId)).toEqual([4, 3]); // отсортировано по убыванию строк
  });

  it("товар без данных в карте считается 0 строк (eligible)", () => {
    const { eligible, skipped } = partitionPrecomputeByQuerySize([7], new Map(), 80_000);
    expect(eligible).toEqual([7]);
    expect(skipped).toEqual([]);
  });
});

describe("describeSkippedMonsters", () => {
  it("сообщает число пропущенных и топ-10 по размеру", () => {
    const skipped = [
      { nmId: 4, rows: 216_560 },
      { nmId: 3, rows: 80_001 },
    ];
    const msg = describeSkippedMonsters(skipped, 80_000);
    expect(msg).toContain("пропущено 2 товаров-монстров");
    expect(msg).toContain(">80000");
    expect(msg).toContain("4(216560)");
  });
});
