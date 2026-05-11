import { describe, expect, it } from "vitest";

import type {
  ProductAdvertisingWorkspaceClusterNumericFilters,
  ProductAdvertisingWorkspaceClusterRow,
} from "./types/product-advertising-workspace.types";
import type { ProductAdvertisingClusterQuery } from "./types/product-advertising-sheet.types";
import {
  buildClusterQuerySearchIndex,
  buildWorkspaceClusterKey,
  matchesClusterNumericFilters,
  matchesClusterSearch,
  matchesClusterStatusFilter,
} from "./product-workspace-cluster-table.filters";

function createClusterRow(
  overrides: Partial<ProductAdvertisingWorkspaceClusterRow> = {},
): ProductAdvertisingWorkspaceClusterRow {
  return {
    clusterKey: "11:кроссовки",
    advertId: 11,
    campaignName: "Campaign",
    campaignType: 8,
    campaignStatus: 9,
    paymentType: "cpm",
    bidType: "auction",
    currency: "RUB",
    clusterName: "Кроссовки",
    canonicalNormQuery: "кроссовки",
    queryCount: 1,
    jamQueryCount: 1,
    jamFrequency: 1000,
    jamClicks: 50,
    jamAddToCart: 10,
    jamOrders: 5,
    jamAvgPosition: 3,
    monthlyFrequency: 1200,
    sourceKind: "active",
    isActive: true,
    views: 100,
    clicks: 40,
    orders: 4,
    addToCart: 10,
    shks: 5,
    ctr: 40,
    avgPosition: 4,
    cpc: 2.5,
    cpm: 1000,
    spend: 100,
    bid: 150,
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

function createNumericFilters(): ProductAdvertisingWorkspaceClusterNumericFilters {
  return {
    jamFrequency: { min: null, max: null },
    jamClicks: { min: null, max: null },
    jamAddToCart: { min: null, max: null },
    jamOrders: { min: null, max: null },
    jamAvgPosition: { min: null, max: null },
    jamCtc: { min: null, max: null },
    jamCto: { min: null, max: null },
    monthlyFrequency: { min: null, max: null },
    bid: { min: null, max: null },
    views: { min: null, max: null },
    clicks: { min: null, max: null },
    ctr: { min: null, max: null },
    addToCart: { min: null, max: null },
    ctc: { min: null, max: null },
    orders: { min: null, max: null },
    cto: { min: null, max: null },
    avgPosition: { min: null, max: null },
    cpc: { min: null, max: null },
    cpm: { min: null, max: null },
    cpo: { min: null, max: null },
    viewToOrder: { min: null, max: null },
    spend: { min: null, max: null },
  };
}

function createClusterQuery(
  overrides: Partial<ProductAdvertisingClusterQuery>,
): ProductAdvertisingClusterQuery {
  return {
    advertId: 11,
    clusterName: "Кроссовки",
    queryText: "женские кеды",
    querySource: "query-map",
    mappingSource: "merged",
    matchConfidence: "exact",
    isFrequencyBacked: false,
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
    monthlyFrequency: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("product workspace cluster table filters", () => {
  it("builds a query search index for one advert and matches normalized query text", () => {
    const index = buildClusterQuerySearchIndex(
      [
        createClusterQuery({
          advertId: 11,
          clusterName: "Кроссовки",
          queryText: " Женские-кеды! ",
        }),
        createClusterQuery({
          advertId: 11,
          clusterName: "Кроссовки",
          queryText: "   ",
        }),
        createClusterQuery({
          advertId: 12,
          clusterName: "Кроссовки",
          queryText: "другая группа",
        }),
      ],
      11,
    );
    const row = createClusterRow({
      clusterKey: buildWorkspaceClusterKey(11, "Кроссовки"),
    });

    expect(index.get("11:кроссовки")).toEqual(["женские кеды"]);
    expect(matchesClusterSearch(row, "кеды", index)).toBe(true);
    expect(matchesClusterSearch(row, "ботинки", index)).toBe(false);
  });

  it("keeps status matching explicit for active and excluded rows", () => {
    const activeRow = createClusterRow({
      sourceKind: "active",
      isActive: true,
    });
    const excludedRow = createClusterRow({
      sourceKind: "stats",
      isActive: false,
    });

    expect(matchesClusterStatusFilter(activeRow, "active")).toBe(true);
    expect(matchesClusterStatusFilter(activeRow, "excluded")).toBe(false);
    expect(matchesClusterStatusFilter(excludedRow, "excluded")).toBe(true);
    expect(matchesClusterStatusFilter(excludedRow, "active")).toBe(false);
    expect(matchesClusterStatusFilter(excludedRow, "all")).toBe(true);
  });

  it("evaluates numeric filters on derived workspace metrics", () => {
    const row = createClusterRow();
    const matchingFilters = createNumericFilters();
    matchingFilters.ctc.min = 25;
    matchingFilters.orders.min = 5;
    matchingFilters.cpo.max = 25;
    matchingFilters.viewToOrder.min = 5;

    const failingFilters = createNumericFilters();
    failingFilters.orders.max = 4;

    expect(matchesClusterNumericFilters(row, matchingFilters)).toBe(true);
    expect(matchesClusterNumericFilters(row, failingFilters)).toBe(false);
  });
});
