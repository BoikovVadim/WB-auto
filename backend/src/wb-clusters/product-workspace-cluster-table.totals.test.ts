import { describe, expect, it } from "vitest";

import type { ProductAdvertisingWorkspaceClusterRow } from "./types/product-advertising-workspace.types";
import { buildClusterTableTotals } from "./product-workspace-cluster-table.totals";

function createClusterRow(
  overrides: Partial<ProductAdvertisingWorkspaceClusterRow> = {},
): ProductAdvertisingWorkspaceClusterRow {
  return {
    clusterKey: "11:cluster",
    advertId: 11,
    campaignName: "Campaign",
    campaignType: 8,
    campaignStatus: 9,
    paymentType: "cpm",
    bidType: "auction",
    currency: "RUB",
    clusterName: "Cluster",
    canonicalNormQuery: "cluster",
    queryCount: 1,
    jamQueryCount: 1,
    jamFrequency: 100,
    jamClicks: 20,
    jamAddToCart: 5,
    jamOrders: 2,
    jamAvgPosition: 2,
    monthlyFrequency: 300,
    sourceKind: "active",
    isActive: true,
    views: 100,
    clicks: 10,
    orders: 3,
    addToCart: 5,
    shks: 4,
    ctr: 10,
    avgPosition: 2,
    cpc: 2,
    cpm: 200,
    spend: 20,
    bid: 100,
    bidSyncStatus: "queued",
    bidConfirmedAt: null,
    bidRetryAt: null,
    bidLastError: null,
    actionSyncStatus: "queued",
    actionRetryAt: null,
    actionLastError: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("product workspace cluster table totals", () => {
  it("aggregates sums, derived ratios, averages, and preferred currency", () => {
    const totals = buildClusterTableTotals([
      createClusterRow(),
      createClusterRow({
        clusterKey: "11:cluster-2",
        clusterName: "Cluster 2",
        currency: null,
        jamQueryCount: 2,
        jamFrequency: 50,
        jamClicks: 10,
        jamAddToCart: 0,
        jamOrders: 1,
        jamAvgPosition: 4,
        monthlyFrequency: 100,
        views: 50,
        clicks: 5,
        orders: 1,
        addToCart: 0,
        shks: null,
        avgPosition: 4,
        spend: 10,
        bid: 200,
      }),
    ]);

    expect(totals.count).toBe(2);
    expect(totals.currency).toBe("RUB");
    expect(totals.views).toBe(150);
    expect(totals.clicks).toBe(15);
    expect(totals.addToCart).toBe(5);
    expect(totals.orders).toBe(5);
    expect(totals.spend).toBe(30);
    expect(totals.monthlyFrequency).toBe(400);
    expect(totals.jamQueryCount).toBe(3);
    expect(totals.bid).toBe(150);
    expect(totals.avgPosition).toBe(3);
    expect(totals.jamAvgPosition).toBe(3);
    expect(totals.ctr).toBeCloseTo(10);
    expect(totals.ctc).toBeCloseTo(33.333333, 5);
    expect(totals.cto).toBeCloseTo(100);
    expect(totals.cpc).toBeCloseTo(2);
    expect(totals.cpm).toBeCloseTo(200);
    expect(totals.cpo).toBeCloseTo(6);
    expect(totals.viewToOrder).toBeCloseTo(3.333333, 5);
  });
});
