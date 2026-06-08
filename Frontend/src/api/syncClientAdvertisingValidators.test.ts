import { describe, expect, it } from "vitest";

import type {
  ProductAdvertisingSheetResponse as BackendProductAdvertisingSheetResponse,
  ProductAdvertisingWorkspaceClusterQueriesResponse as BackendProductAdvertisingWorkspaceClusterQueriesResponse,
  ProductAdvertisingWorkspaceClusterTableResponse as BackendProductAdvertisingWorkspaceClusterTableResponse,
  ProductAdvertisingWorkspaceResponse as BackendProductAdvertisingWorkspaceResponse,
  ProductSnapshotReadinessResponse as BackendProductSnapshotReadinessResponse,
} from "../../../backend/src/wb-clusters/wb-clusters.types";
import type {
  ProductAdvertisingSheetResponse as FrontendProductAdvertisingSheetResponse,
  ProductAdvertisingWorkspaceClusterQueriesResponse as FrontendProductAdvertisingWorkspaceClusterQueriesResponse,
  ProductAdvertisingWorkspaceClusterTableResponse as FrontendProductAdvertisingWorkspaceClusterTableResponse,
  ProductAdvertisingWorkspaceResponse as FrontendProductAdvertisingWorkspaceResponse,
  ProductSnapshotReadinessResponse as FrontendProductSnapshotReadinessResponse,
} from "./syncClientTypes";
import {
  assertProductAdvertisingSheetResponse,
  assertProductAdvertisingWorkspaceClusterQueriesResponse,
  assertProductAdvertisingWorkspaceClusterTableResponse,
  assertProductAdvertisingWorkspaceResponse,
  assertProductSnapshotReadinessResponse,
} from "./syncClientValidators";

type ContractSheetResponse =
  BackendProductAdvertisingSheetResponse & FrontendProductAdvertisingSheetResponse;
type ContractWorkspaceResponse =
  BackendProductAdvertisingWorkspaceResponse & FrontendProductAdvertisingWorkspaceResponse;
type ContractClusterTableResponse =
  BackendProductAdvertisingWorkspaceClusterTableResponse &
    FrontendProductAdvertisingWorkspaceClusterTableResponse;
type ContractClusterQueriesResponse =
  BackendProductAdvertisingWorkspaceClusterQueriesResponse &
    FrontendProductAdvertisingWorkspaceClusterQueriesResponse;
type ContractSnapshotReadinessResponse =
  BackendProductSnapshotReadinessResponse & FrontendProductSnapshotReadinessResponse;

function buildContractSheetFixture(): ContractSheetResponse {
  return {
    nmId: 123456,
    checkedAt: "2026-05-08T07:00:00.000Z",
    snapshot: {
      status: "ready",
      fit: "exact",
      source: "exact_snapshot",
      builtAt: "2026-05-08T06:59:00.000Z",
      requestedStartDate: "2026-05-01",
      requestedEndDate: "2026-05-07",
      snapshotStartDate: "2026-05-01",
      snapshotEndDate: "2026-05-07",
      builtFromExportRequestId: "export-1",
      lastError: null,
    },
    range: {
      startDate: "2026-05-01",
      endDate: "2026-05-07",
      jamIncluded: true,
      jamStatus: "ready",
    },
    summary: {
      campaignsCount: 1,
      clustersCount: 1,
      clusterQueriesCount: 1,
      dailyStatsCount: 1,
      minusPhrasesCount: 0,
      keywordStatsCount: 0,
      queryCoverageStatus: "ready",
      queryCoverageReason: null,
      dailyStatsCoverageStatus: "full",
      dailyStatsCoverageReason: null,
      dailyStatsWindowStartDate: "2026-05-01",
      dailyStatsWindowEndDate: "2026-05-07",
      periodMetricsStatus: "exact",
      periodMetricsReason: null,
      periodMetricsActualStartDate: "2026-05-01",
      periodMetricsActualEndDate: "2026-05-07",
    },
    campaigns: [
      {
        advertId: 10,
        campaignType: 8,
        campaignStatus: 9,
        paymentType: "cpm",
        bidType: "manual",
        placementsSearch: true,
        placementsRecommendations: false,
        currency: "RUB",
        name: "Campaign",
        subjectId: 101,
        subjectName: "Shoes",
        changeTime: "2026-05-08T06:58:00.000Z",
        createdAtWb: "2026-04-30T10:00:00.000Z",
        startedAtWb: "2026-05-01T00:00:00.000Z",
        updatedAtWb: "2026-05-08T06:58:00.000Z",
        syncedAt: "2026-05-08T06:59:00.000Z",
      },
    ],
    clusters: [
      {
        advertId: 10,
        campaignName: "Campaign",
        campaignType: 8,
        campaignStatus: 9,
        paymentType: "cpm",
        bidType: "manual",
        currency: "RUB",
        clusterName: "Кеды",
        canonicalNormQuery: "кеды",
        sourceKind: "active",
        isActive: true,
        views: 100,
        clicks: 10,
        orders: 2,
        addToCart: 3,
        shks: 2,
        ctr: 10,
        avgPosition: 1.5,
        cpc: 12,
        cpm: 55,
        spend: 120,
        bid: 150,
        bidSyncStatus: "confirmed",
        bidConfirmedAt: "2026-05-08T06:57:00.000Z",
        bidRetryAt: null,
        bidLastError: null,
        actionSyncStatus: "confirmed",
        actionRetryAt: null,
        actionLastError: null,
        queryCount: 1,
        jamQueryCount: 1,
        jamFrequency: 200,
        jamClicks: 15,
        jamAddToCart: 4,
        jamOrders: 2,
        jamAvgPosition: 2.3,
        monthlyFrequency: 500,
        updatedAt: "2026-05-08T06:56:00.000Z",
      },
    ],
    clusterQueries: [
      {
        advertId: 10,
        clusterName: "Кеды",
        queryText: "кеды",
        querySource: "query-map",
        mappingSource: "merged",
        matchConfidence: "trusted-source",
        isFrequencyBacked: true,
        isClusterConfirmed: true,
        isCanonicalClusterQuery: true,
        isCabinetBacked: false,
        cabinetSnapshotAt: null,
        sourceKind: "active",
        isActive: true,
        views: 100,
        clicks: 10,
        orders: 2,
        addToCart: 3,
        shks: 2,
        jamFrequency: 200,
        jamClicks: 15,
        jamAddToCart: 4,
        jamOrders: 2,
        jamAvgPosition: 2.3,
        jamOpenToCart: 25,
        monthlyFrequency: 500,
        updatedAt: "2026-05-08T06:56:00.000Z",
      },
    ],
    dailyStats: [
      {
        advertId: 10,
        date: "2026-05-07",
        clusterName: "Кеды",
        views: 100,
        clicks: 10,
        orders: 2,
        addToCart: 3,
        shks: 2,
        ctr: 10,
        avgPosition: 1.5,
        cpc: 12,
        cpm: 55,
        spend: 120,
        currency: "RUB",
        updatedAt: "2026-05-08T06:56:00.000Z",
      },
    ],
    minusPhrases: [],
    keywordStats: [],
  };
}

function buildContractWorkspaceFixture(): ContractWorkspaceResponse {
  const sheet = buildContractSheetFixture();
  return {
    nmId: sheet.nmId,
    checkedAt: sheet.checkedAt,
    revision: {
      key: "wb-product-advertising:workspace:123456:none:none:2026-05-01:2026-05-07:2026-05-08T07:00:00.000Z",
      builtAt: sheet.checkedAt,
    },
    readiness: {
      scope: "workspace",
      status: "ready",
      source: "workspace_snapshot",
      materializationStatus: "materialized",
    },
    header: {
      nmId: sheet.nmId,
      vendorCode: "VC-123",
      productName: "Кеды",
      brandName: "Brand",
      subjectName: "Shoes",
    },
    snapshot: sheet.snapshot,
    range: sheet.range,
    dateBounds: {
      minDate: "2026-05-01",
      maxDate: "2026-05-07",
      defaultStartDate: "2026-05-01",
      defaultEndDate: "2026-05-07",
    },
    campaignTabs: [
      {
        advertId: 10,
        campaignName: "Campaign",
        campaignType: 9,
        campaignStatus: 9,
        paymentType: "cpm",
        bidType: "manual",
        currency: "RUB",
        syncedAt: "2026-05-08T06:59:00.000Z",
        rowsCount: 1,
        totals: {
          spend: 120,
          orders: 2,
          clicks: 10,
          views: 100,
          addToCart: 3,
          ctr: 10,
          ctc: 30,
          cto: 66.7,
          cpc: 12,
          cpm: 55,
          cpo: 60,
          viewToOrder: 2,
          activeCount: 1,
          excludedCount: 0,
        },
      },
    ],
    defaultCampaignId: 10,
    selectedCampaignSummary: {
      advertId: 10,
      campaignName: "Campaign",
      campaignType: 9,
      campaignStatus: 9,
      paymentType: "cpm",
      bidType: "manual",
      currency: "RUB",
      syncedAt: "2026-05-08T06:59:00.000Z",
      rowsCount: 1,
      totals: {
        spend: 120,
        orders: 2,
        clicks: 10,
        views: 100,
        addToCart: 3,
        ctr: 10,
        ctc: 30,
        cto: 66.7,
        cpc: 12,
        cpm: 55,
        cpo: 60,
        viewToOrder: 2,
        activeCount: 1,
        excludedCount: 0,
      },
    },
    initialClusterTable: null,
    syncState: {
      hasPendingClusterSync: false,
      refreshStatus: "idle",
      syncRunId: null,
      startedAt: null,
    },
    diagnostics: {
      periodMetricsStatus: "exact",
      periodMetricsActualStartDate: "2026-05-01",
      periodMetricsActualEndDate: "2026-05-07",
      dailyStatsWindowStartDate: "2026-05-01",
      dailyStatsWindowEndDate: "2026-05-07",
      queryCoverageStatus: "ready",
    },
  };
}

function buildContractClusterTableFixture(): ContractClusterTableResponse {
  return {
    nmId: 123456,
    advertId: 10,
    checkedAt: "2026-05-08T07:00:00.000Z",
    revision: {
      key: "wb-product-advertising:cluster_table:123456:10:none:2026-05-01:2026-05-07:2026-05-08T07:00:00.000Z",
      builtAt: "2026-05-08T07:00:00.000Z",
    },
    readiness: {
      scope: "cluster_table",
      status: "ready",
      source: "workspace_snapshot",
      materializationStatus: "materialized",
    },
    rows: [
      {
        clusterKey: "10:кеды",
        advertId: 10,
        campaignName: "Campaign",
        campaignType: 8,
        campaignStatus: 9,
        paymentType: "cpm",
        bidType: "manual",
        currency: "RUB",
        clusterName: "Кеды",
        canonicalNormQuery: "кеды",
        queryCount: 1,
        jamQueryCount: 1,
        jamFrequency: 200,
        jamClicks: 15,
        jamAddToCart: 4,
        jamOrders: 2,
        jamAvgPosition: 2.3,
        monthlyFrequency: 500,
        sourceKind: "active",
        isActive: true,
        views: 100,
        clicks: 10,
        orders: 2,
        addToCart: 3,
        shks: 2,
        ctr: 10,
        avgPosition: 1.5,
        cpc: 12,
        cpm: 55,
        spend: 120,
        bid: 150,
        bidSyncStatus: "confirmed",
        bidConfirmedAt: "2026-05-08T06:57:00.000Z",
        bidRetryAt: null,
        bidLastError: null,
        actionSyncStatus: "confirmed",
        actionRetryAt: null,
        actionLastError: null,
        updatedAt: "2026-05-08T06:56:00.000Z",
      },
    ],
    totals: {
      count: 1,
      jamQueryCount: 1,
      jamFrequency: 200,
      jamClicks: 15,
      jamAddToCart: 4,
      jamOrders: 2,
      jamAvgPosition: 2.3,
      monthlyFrequency: 500,
      bid: 150,
      views: 100,
      clicks: 10,
      ctr: 10,
      addToCart: 3,
      ctc: 30,
      orders: 2,
      cto: 66.7,
      avgPosition: 1.5,
      cpc: 12,
      cpm: 55,
      cpo: 60,
      viewToOrder: 2,
      spend: 120,
      currency: "RUB",
      accruedSpend: 120,
      accruedOrders: 2,
      accruedCpo: 60,
      accruedCr: 2,
    },
    totalsScope: "filtered_population",
    filterCounts: {
      all: 1,
      active: 1,
      excluded: 0,
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
      pageSize: 200,
      totalRows: 1,
      totalPages: 1,
    },
  };
}

function buildContractClusterQueriesFixture(): ContractClusterQueriesResponse {
  return {
    nmId: 123456,
    advertId: 10,
    clusterKey: "10:кеды",
    clusterName: "Кеды",
    checkedAt: "2026-05-08T07:00:00.000Z",
    revision: {
      key: "wb-product-advertising:cluster_queries:123456:10:10:кеды:2026-05-01:2026-05-07:2026-05-08T07:00:00.000Z",
      builtAt: "2026-05-08T07:00:00.000Z",
    },
    readiness: {
      scope: "cluster_queries",
      status: "ready",
      source: "workspace_snapshot",
      materializationStatus: "materialized",
    },
    queries: [
      {
        advertId: 10,
        clusterName: "Кеды",
        queryText: "кеды",
        querySource: "query-map",
        mappingSource: "merged",
        matchConfidence: "trusted-source",
        isFrequencyBacked: true,
        isClusterConfirmed: true,
        isCanonicalClusterQuery: true,
        isCabinetBacked: false,
        cabinetSnapshotAt: null,
        sourceKind: "active",
        isActive: true,
        views: 100,
        clicks: 10,
        orders: 2,
        addToCart: 3,
        shks: 2,
        jamFrequency: 200,
        jamClicks: 15,
        jamAddToCart: 4,
        jamOrders: 2,
        jamAvgPosition: 2.3,
        jamOpenToCart: 25,
        monthlyFrequency: 500,
        updatedAt: "2026-05-08T06:56:00.000Z",
      },
    ],
    sort: {
      key: "spend",
      direction: "desc",
    },
  };
}

function buildContractSnapshotReadinessFixture(): ContractSnapshotReadinessResponse {
  return {
    checkedAt: "2026-05-08T07:00:00.000Z",
    exportRequestId: "export-1",
    range: {
      startDate: "2026-05-01",
      endDate: "2026-05-07",
    },
    items: [
      {
        nmId: 123456,
        status: "ready",
        priority: "visible",
        snapshotFit: "exact",
        snapshotSource: "exact_snapshot",
        builtAt: "2026-05-08T06:59:00.000Z",
        failureReason: null,
        requestedStartDate: "2026-05-01",
        requestedEndDate: "2026-05-07",
        snapshotStartDate: "2026-05-01",
        snapshotEndDate: "2026-05-07",
        updatedAt: "2026-05-08T06:59:00.000Z",
      },
    ],
  };
}

describe("syncClient advertising contract validators", () => {
  it("accepts backend-aligned advertising fixtures", () => {
    const sheet = buildContractSheetFixture();
    const workspace = buildContractWorkspaceFixture();
    const clusterTable = buildContractClusterTableFixture();
    const clusterQueries = buildContractClusterQueriesFixture();
    const readiness = buildContractSnapshotReadinessFixture();

    expect(() => assertProductAdvertisingSheetResponse(sheet)).not.toThrow();
    expect(() => assertProductAdvertisingWorkspaceResponse(workspace)).not.toThrow();
    expect(() => assertProductAdvertisingWorkspaceClusterTableResponse(clusterTable)).not.toThrow();
    expect(() => assertProductAdvertisingWorkspaceClusterQueriesResponse(clusterQueries)).not.toThrow();
    expect(() => assertProductSnapshotReadinessResponse(readiness)).not.toThrow();
  });

  it("rejects workspace diagnostics with invalid machine-readable statuses", () => {
    const workspace = buildContractWorkspaceFixture();
    const brokenWorkspace = {
      ...workspace,
      diagnostics: {
        ...workspace.diagnostics,
        periodMetricsStatus: "almost_ready",
      },
    };

    expect(() => assertProductAdvertisingWorkspaceResponse(brokenWorkspace)).toThrow(
      "Invalid product advertising workspace response.",
    );
  });

  it("accepts cluster-table payloads without querySearchIndex", () => {
    const clusterTable = buildContractClusterTableFixture();
    delete clusterTable.querySearchIndex;

    expect(() => assertProductAdvertisingWorkspaceClusterTableResponse(clusterTable)).not.toThrow();
  });
});
