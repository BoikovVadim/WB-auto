import { describe, expect, it } from "vitest";

import {
  buildAggregateSafeClusterFrequencyGroupKey,
  buildAggregateSafeClusterFrequencyIndex,
} from "./product-advertising-sheet.frequency";
import type { ProductAdvertisingClusterQuery } from "./types/product-advertising-sheet.types";

function createClusterQuery(
  overrides: Partial<ProductAdvertisingClusterQuery>,
): ProductAdvertisingClusterQuery {
  return {
    advertId: 77,
    clusterName: "Большая клетка",
    queryText: "Большая клетка",
    querySource: "cluster-name",
    mappingSource: "promotion",
    matchConfidence: "exact",
    isFrequencyBacked: true,
    isClusterConfirmed: true,
    isCanonicalClusterQuery: true,
    isCabinetBacked: false,
    cabinetSnapshotAt: null,
    sourceKind: "active",
    isActive: true,
    views: null,
    clicks: null,
    orders: null,
    addToCart: null,
    shks: null,
    jamFrequency: null,
    jamClicks: null,
    jamAddToCart: null,
    jamOrders: null,
    jamAvgPosition: null,
    jamOpenToCart: null,
    monthlyFrequency: 370,
    updatedAt: "2026-05-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("product advertising sheet frequency", () => {
  it("sums only aggregate-safe query frequencies per cluster", () => {
    const normalizeAdvertisingText = (value: string) => value.trim().toLocaleLowerCase("ru");
    const frequencyByCluster = buildAggregateSafeClusterFrequencyIndex({
      clusterQueries: [
        createClusterQuery({
          queryText: "Большая клетка",
          querySource: "cluster-name",
          monthlyFrequency: 370,
        }),
        createClusterQuery({
          queryText: "Большая клетка для собак",
          querySource: "frequency-backed",
          matchConfidence: "frequency-backed",
          monthlyFrequency: 120,
        }),
        createClusterQuery({
          queryText: "Супер клетка акция",
          querySource: "soft-match",
          matchConfidence: "soft-match",
          monthlyFrequency: 900,
        }),
        createClusterQuery({
          advertId: 88,
          clusterName: "Миска",
          queryText: "Миска",
          querySource: "cluster-name",
          monthlyFrequency: 55,
        }),
      ],
      normalizeAdvertisingText,
    });

    expect(
      frequencyByCluster.get(
        buildAggregateSafeClusterFrequencyGroupKey(77, "Большая клетка", normalizeAdvertisingText),
      ),
    ).toBe(490);
    expect(
      frequencyByCluster.get(
        buildAggregateSafeClusterFrequencyGroupKey(88, "Миска", normalizeAdvertisingText),
      ),
    ).toBe(55);
  });
});
