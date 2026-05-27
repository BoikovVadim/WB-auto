import { describe, expect, it } from "vitest";

import type { ProductAdvertisingWorkspaceResponse } from "../../../api/syncClient";
import { buildPendingProductAdvertisingWorkspace } from "./productAdvertisingWorkspacePendingState";

function buildWorkspaceFixture(): ProductAdvertisingWorkspaceResponse {
  return {
    nmId: 334198666,
    checkedAt: "2026-05-18T03:00:00.000Z",
    revision: {
      key: "wb-product-advertising:workspace:334198666:none:none:2026-05-01:2026-05-18:2026-05-18T03:00:00.000Z",
      builtAt: "2026-05-18T03:00:00.000Z",
    },
    readiness: {
      scope: "workspace",
      status: "ready",
      source: "workspace_snapshot",
      materializationStatus: "materialized",
    },
    header: {
      nmId: 334198666,
      vendorCode: "animal cage 107",
      productName: "animal cage 107",
      brandName: "brand",
      subjectName: "Клетки для животных",
    },
    snapshot: {
      status: "ready",
      fit: "exact",
      source: "exact_snapshot",
      builtAt: "2026-05-18T02:59:00.000Z",
      requestedStartDate: "2026-05-01",
      requestedEndDate: "2026-05-18",
      snapshotStartDate: "2026-05-01",
      snapshotEndDate: "2026-05-18",
      builtFromExportRequestId: "export-1",
      lastError: null,
    },
    range: {
      startDate: "2026-05-01",
      endDate: "2026-05-18",
      jamIncluded: true,
      jamStatus: "ready",
    },
    dateBounds: {
      minDate: "2026-04-01",
      maxDate: "2026-05-18",
      defaultStartDate: "2026-05-01",
      defaultEndDate: "2026-05-18",
    },
    campaignTabs: [
      {
        advertId: 101,
        campaignName: "Search",
        campaignType: 8,
        campaignStatus: 9,
        paymentType: "cpm",
        bidType: "manual",
        placementsSearch: true,
        placementsRecommendations: false,
        currency: "RUB",
        syncedAt: "2026-05-18T02:58:00.000Z",
        rowsCount: 75,
        totals: {
          spend: 1000,
          orders: 5,
          clicks: 40,
          views: 500,
          addToCart: 8,
          ctr: 8,
          ctc: 20,
          cto: 62.5,
          cpc: 25,
          cpm: 2000,
          cpo: 200,
          viewToOrder: 1,
          activeCount: 23,
          excludedCount: 52,
        },
      },
    ],
    defaultCampaignId: 101,
    selectedCampaignSummary: {
      advertId: 101,
      campaignName: "Search",
      campaignType: 8,
      campaignStatus: 9,
      paymentType: "cpm",
      bidType: "manual",
      placementsSearch: true,
      placementsRecommendations: false,
      currency: "RUB",
      syncedAt: "2026-05-18T02:58:00.000Z",
      rowsCount: 75,
      totals: {
        spend: 1000,
        orders: 5,
        clicks: 40,
        views: 500,
        addToCart: 8,
        ctr: 8,
        ctc: 20,
        cto: 62.5,
        cpc: 25,
        cpm: 2000,
        cpo: 200,
        viewToOrder: 1,
        activeCount: 23,
        excludedCount: 52,
      },
    },
    initialClusterTable: {
      nmId: 334198666,
      advertId: 101,
      checkedAt: "2026-05-18T03:00:00.000Z",
      revision: {
        key: "wb-product-advertising:cluster_table:334198666:101:none:2026-05-01:2026-05-18:2026-05-18T03:00:00.000Z",
        builtAt: "2026-05-18T03:00:00.000Z",
      },
      readiness: {
        scope: "cluster_table",
        status: "ready",
        source: "workspace_snapshot",
        materializationStatus: "materialized",
      },
      rows: [],
      totals: {
        count: 0,
        jamQueryCount: null,
        jamFrequency: null,
        jamClicks: null,
        jamAddToCart: null,
        jamOrders: null,
        jamAvgPosition: null,
        monthlyFrequency: null,
        bid: null,
        views: null,
        clicks: null,
        ctr: null,
        addToCart: null,
        ctc: null,
        orders: null,
        cto: null,
        avgPosition: null,
        cpc: null,
        cpm: null,
        cpo: null,
        viewToOrder: null,
        spend: null,
        currency: "RUB",
      },
      totalsScope: "filtered_population",
      filterCounts: {
        all: 75,
        active: 23,
        excluded: 52,
      },
      appliedFilters: {
        search: "",
        clusterNameSearch: "",
        status: "all",
        numericFilters: {
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
        },
      },
      sort: {
        key: "spend",
        direction: "desc",
      },
      pagination: {
        page: 1,
        pageSize: 5000,
        totalRows: 0,
        totalPages: 1,
      },
    },
    syncState: {
      hasPendingClusterSync: false,
      refreshStatus: "idle",
      syncRunId: null,
      startedAt: null,
    },
    diagnostics: {
      periodMetricsStatus: "exact",
      periodMetricsActualStartDate: "2026-05-01",
      periodMetricsActualEndDate: "2026-05-18",
      dailyStatsWindowStartDate: "2026-05-01",
      dailyStatsWindowEndDate: "2026-05-18",
      queryCoverageStatus: "ready",
    },
  };
}

describe("buildPendingProductAdvertisingWorkspace", () => {
  it("keeps shell visible but clears stale summary counts", () => {
    const pending = buildPendingProductAdvertisingWorkspace(buildWorkspaceFixture());

    expect(pending.campaignTabs[0]?.rowsCount).toBe(0);
    expect(pending.campaignTabs[0]?.totals.activeCount).toBe(0);
    expect(pending.campaignTabs[0]?.totals.excludedCount).toBe(0);
    expect(pending.selectedCampaignSummary?.rowsCount).toBe(0);
    expect(pending.selectedCampaignSummary?.totals.activeCount).toBe(0);
    expect(pending.selectedCampaignSummary?.totals.excludedCount).toBe(0);
    expect(pending.initialClusterTable).toBeNull();
    expect(pending.header.vendorCode).toBe("animal cage 107");
  });
});
