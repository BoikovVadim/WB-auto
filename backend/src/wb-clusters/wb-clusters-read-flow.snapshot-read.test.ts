import { describe, expect, it, vi } from "vitest";

import {
  getProductAdvertisingSheetBundle,
  getProductAdvertisingWorkspaceClusterQueries,
  getProductAdvertisingWorkspaceClusterTable,
} from "./wb-clusters-read-flow.snapshot-read";
import type { WbClustersSnapshotReadContext } from "./wb-clusters.flow-context";

function createFallbackSheet() {
  return {
    nmId: 321,
    checkedAt: "2024-03-31T10:00:00.000Z",
    snapshot: {
      status: "ready",
      fit: "exact",
      source: "exact_snapshot",
      builtAt: "2024-03-31T10:00:00.000Z",
      requestedStartDate: "2024-03-01",
      requestedEndDate: "2024-03-31",
      snapshotStartDate: "2024-03-01",
      snapshotEndDate: "2024-03-31",
      builtFromExportRequestId: null,
      lastError: null,
    },
    range: {
      startDate: "2024-03-01",
      endDate: "2024-03-31",
      jamIncluded: true,
      jamStatus: "ready",
    },
    summary: {
      campaignsCount: 1,
      clustersCount: 1,
      clusterQueriesCount: 1,
      dailyStatsCount: 0,
      minusPhrasesCount: 0,
      keywordStatsCount: 0,
      queryCoverageStatus: "ready",
      queryCoverageReason: null,
      dailyStatsCoverageStatus: "not_requested",
      dailyStatsCoverageReason: null,
      dailyStatsWindowStartDate: null,
      dailyStatsWindowEndDate: null,
      periodMetricsStatus: "exact",
      periodMetricsReason: null,
      periodMetricsActualStartDate: "2024-03-01",
      periodMetricsActualEndDate: "2024-03-31",
    },
    campaigns: [
      {
        advertId: 11,
        name: "Campaign",
        campaignStatus: 1,
        paymentType: "cpm",
        bidType: "auto",
        currency: "RUB",
        syncedAt: "2024-03-31T10:00:00.000Z",
      },
    ],
    clusters: [
      {
        advertId: 11,
        campaignName: "Campaign",
        campaignType: 1,
        campaignStatus: 1,
        paymentType: "cpm",
        bidType: "auto",
        currency: "RUB",
        clusterName: "Кеды",
        canonicalNormQuery: "кеды",
        queryCount: 1,
        jamQueryCount: 1,
        jamFrequency: 10,
        jamClicks: 2,
        jamAddToCart: 1,
        jamOrders: 1,
        jamAvgPosition: 1,
        monthlyFrequency: 10,
        sourceKind: "active",
        isActive: true,
        views: 100,
        clicks: 10,
        orders: 1,
        addToCart: 1,
        shks: 1,
        ctr: 0.1,
        avgPosition: 1,
        cpc: 5,
        cpm: 50,
        spend: 50,
        bid: 100,
        bidSyncStatus: "confirmed",
        bidConfirmedAt: null,
        bidRetryAt: null,
        bidLastError: null,
        actionSyncStatus: "confirmed",
        actionRetryAt: null,
        actionLastError: null,
        updatedAt: "2024-03-31T10:00:00.000Z",
      },
    ],
    clusterQueries: [
      {
        advertId: 11,
        clusterName: "Кеды",
        queryText: "кеды",
        isCanonicalClusterQuery: true,
        sourceKind: "active",
        isActive: true,
        views: 100,
        clicks: 10,
        addToCart: 1,
        orders: 1,
        monthlyFrequency: 10,
        jamFrequency: 10,
        jamClicks: 2,
        jamAddToCart: 1,
        jamOrders: 1,
        jamAvgPosition: 1,
      },
    ],
    dailyStats: [],
    minusPhrases: [],
    keywordStats: [],
  };
}

function createEmptyNumericFilters() {
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

describe("wb-clusters snapshot read flow", () => {
  it("falls back to sheet-backed workspace campaign rows when storage is not materialized yet", async () => {
    const resolveWorkspaceCampaignRows = vi.fn().mockResolvedValue(null);
    const resolve = vi.fn().mockResolvedValue(createFallbackSheet());
    const self = {
      productAdvertisingSheetSnapshotSchemaVersion: 7,
      normalizeAdvertisingSheetJamRange: vi.fn().mockReturnValue({
        start: "2024-03-01",
        end: "2024-03-31",
      }),
      productWorkspaceSnapshotResolver: {
        resolveWorkspaceCampaignRows,
      },
      productAdvertisingSnapshotResolver: {
        resolve,
      },
      productAdvertisingWorkspaceReadService: {
        normalizeWorkspaceClusterNumericFilters: vi.fn().mockReturnValue(createEmptyNumericFilters()),
      },
      productAdvertisingClusterTableResponseCache: new Map(),
      productAdvertisingClusterTableResponseCacheTtlMs: 180_000,
    };

    const result = await getProductAdvertisingWorkspaceClusterTable(
      self as unknown as WbClustersSnapshotReadContext,
      321,
      11,
      {},
    );

    expect(resolveWorkspaceCampaignRows).toHaveBeenCalledWith({
      nmId: 321,
      advertId: 11,
      currentPeriod: null,
      schemaVersion: 7,
    });
    expect(resolve).toHaveBeenCalledWith({
      nmId: 321,
      currentPeriod: null,
      schemaVersion: 7,
    });
    expect(result.readiness).toEqual({
      scope: "cluster_table",
      status: "ready",
      source: "sheet_snapshot",
      materializationStatus: "fallback_sheet",
    });
  });

  it("derives cluster keys from cluster names and prefers stored cluster metadata", async () => {
    const buildClusterQueriesResponse = vi.fn().mockReturnValue({ ok: true });
    const resolveWorkspaceClusterQueries = vi.fn().mockResolvedValue({
      clusterName: "Stored cluster",
      payload: {
        checkedAt: "2024-03-31T10:00:00.000Z",
        queries: [{ queryText: "кеды" }],
      },
    });
    const self = {
      productAdvertisingSheetSnapshotSchemaVersion: 9,
      normalizeAdvertisingSheetJamRange: vi.fn().mockReturnValue({
        start: "2024-03-01",
        end: "2024-03-31",
      }),
      normalizeAdvertisingText: vi.fn().mockImplementation((value: string) =>
        value.trim().toLocaleLowerCase("ru"),
      ),
      productWorkspaceSnapshotResolver: {
        resolveWorkspaceClusterQueries,
      },
      productAdvertisingWorkspaceReadService: {
        buildClusterQueriesResponse,
      },
    };

    const result = await getProductAdvertisingWorkspaceClusterQueries(
      self as unknown as WbClustersSnapshotReadContext,
      555,
      11,
      {
        clusterName: "  Кеды  ",
      },
    );

    expect(result).toEqual({
      ok: true,
      readiness: {
        scope: "cluster_queries",
        status: "ready",
        source: "workspace_snapshot",
        materializationStatus: "materialized",
      },
    });
    expect(resolveWorkspaceClusterQueries).toHaveBeenCalledWith({
      nmId: 555,
      advertId: 11,
      clusterKey: "11:кеды",
      currentPeriod: null,
      schemaVersion: 9,
    });
    expect(buildClusterQueriesResponse).toHaveBeenCalledWith({
      nmId: 555,
      snapshot: {
        checkedAt: "2024-03-31T10:00:00.000Z",
        queries: [{ queryText: "кеды" }],
      },
      advertId: 11,
      clusterKey: "11:кеды",
      clusterName: "Stored cluster",
      sortKey: "spend",
      sortDirection: "desc",
      normalizeAdvertisingText: expect.any(Function),
    });
  });

  it("falls back to sheet-backed workspace queries when storage is not materialized yet", async () => {
    const resolveWorkspaceClusterQueries = vi.fn().mockResolvedValue(null);
    const resolve = vi.fn().mockResolvedValue(createFallbackSheet());
    // SQL fast path returns null → code falls back to PATH B sheet resolve.
    const getWorkspaceClusterQueriesSQL = vi.fn().mockResolvedValue(null);
    const self = {
      productAdvertisingSheetSnapshotSchemaVersion: 9,
      normalizeAdvertisingSheetJamRange: vi.fn().mockReturnValue({
        start: "2024-03-01",
        end: "2024-03-31",
      }),
      normalizeAdvertisingText: vi.fn().mockImplementation((value: string) =>
        value.trim().toLocaleLowerCase("ru"),
      ),
      productWorkspaceSnapshotResolver: {
        resolveWorkspaceClusterQueries,
      },
      productAdvertisingSnapshotResolver: {
        resolve,
      },
      productAdvertisingReadRepository: {
        getWorkspaceClusterQueriesSQL,
      },
      productAdvertisingWorkspaceReadService: {
      },
    };

    const result = await getProductAdvertisingWorkspaceClusterQueries(
      self as unknown as WbClustersSnapshotReadContext,
      555,
      11,
      {
        clusterName: "  Кеды  ",
      },
    );

    expect(resolveWorkspaceClusterQueries).toHaveBeenCalledWith({
      nmId: 555,
      advertId: 11,
      clusterKey: "11:кеды",
      currentPeriod: null,
      schemaVersion: 9,
    });
    expect(resolve).toHaveBeenCalledWith({
      nmId: 555,
      currentPeriod: null,
      schemaVersion: 9,
    });
    expect(result.readiness).toEqual({
      scope: "cluster_queries",
      status: "ready",
      source: "sheet_snapshot",
      materializationStatus: "fallback_sheet",
    });
  });

  it("deduplicates and validates nmIds before resolving a bundle", async () => {
    const resolveMany = vi.fn().mockResolvedValue([{ nmId: 1001 }]);
    const self = {
      productAdvertisingSheetSnapshotSchemaVersion: 3,
      normalizeAdvertisingSheetJamRange: vi.fn().mockReturnValue({
        start: "2024-04-01",
        end: "2024-04-30",
      }),
      productAdvertisingSnapshotResolver: {
        resolveMany,
      },
    };

    const bundle = await getProductAdvertisingSheetBundle(
      self as unknown as WbClustersSnapshotReadContext,
      {
        nmIds: [1001, 1001, 0, -1, 2002, 1.5],
        startDate: "2024-04-01",
        endDate: "2024-04-30",
      },
    );

    expect(resolveMany).toHaveBeenCalledWith({
      nmIds: [1001, 2002],
      currentPeriod: {
        start: "2024-04-01",
        end: "2024-04-30",
      },
      schemaVersion: 3,
    });
    expect(bundle.range).toEqual({
      startDate: "2024-04-01",
      endDate: "2024-04-30",
    });
    expect(bundle.sheets).toEqual([{ nmId: 1001 }]);
    expect(Number.isNaN(Date.parse(bundle.checkedAt))).toBe(false);
  });
});
