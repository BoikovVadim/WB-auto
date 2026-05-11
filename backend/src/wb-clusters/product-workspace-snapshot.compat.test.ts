import { describe, expect, it } from "vitest";

import {
  normalizeStoredWorkspacePayload,
  normalizeWorkspaceCampaignRowsSnapshot,
  normalizeWorkspaceClusterQueriesSnapshot,
} from "./product-workspace-snapshot.compat";

describe("product workspace snapshot compatibility", () => {
  it("normalizes legacy workspace shell payloads without syncState", () => {
    const result = normalizeStoredWorkspacePayload({
      payload: {
        nmId: 198676662,
        checkedAt: "2026-05-07T19:00:00.000Z",
        header: {
          nmId: 198676662,
          vendorCode: "animal-cage",
          productName: "Animal cage",
          brandName: "Oqqi",
          subjectName: "Клетки",
        },
        snapshot: {
          status: "ready",
          fit: "most_recent",
          source: "most_recent_snapshot",
        },
        range: {
          startDate: "2026-05-07",
          endDate: "2026-05-07",
          jamIncluded: true,
          jamStatus: "ready",
        },
        dateBounds: {
          minDate: "2026-05-01",
          maxDate: "2026-05-07",
          defaultStartDate: "2026-05-07",
          defaultEndDate: "2026-05-07",
        },
        campaignTabs: [
          {
            advertId: 123,
            campaignName: "Campaign 123",
            campaignStatus: 9,
            paymentType: "cpm",
            bidType: "auction",
            currency: "RUB",
            syncedAt: "2026-05-07T19:00:00.000Z",
            rowsCount: 10,
            totals: {
              spend: 100,
              orders: 1,
              clicks: 20,
              views: 1000,
              addToCart: 3,
              ctr: 0.02,
              ctc: 0.15,
              cto: 0.33,
              cpc: 5,
              cpm: 100,
              cpo: 100,
              viewToOrder: 0.001,
              activeCount: 8,
              excludedCount: 2,
            },
          },
        ],
        defaultCampaignId: 123,
        diagnostics: {
          queryCoverageStatus: "ready",
          periodMetricsStatus: "unavailable",
        },
      },
      currentRefresh: null,
    });

    expect(result).not.toBeNull();
    expect(result?.selectedCampaignSummary?.advertId).toBe(123);
    expect(result?.syncState).toEqual({
      hasPendingClusterSync: false,
      refreshStatus: "idle",
      syncRunId: null,
      startedAt: null,
    });
    expect(result?.readiness).toEqual({
      scope: "workspace",
      status: "ready",
      source: "workspace_snapshot",
      materializationStatus: "materialized",
    });
  });

  it("normalizes legacy campaign row snapshots without query search index", () => {
    const result = normalizeWorkspaceCampaignRowsSnapshot(
      {
        checkedAt: "2026-05-07T19:00:00.000Z",
        rows: [
          {
            clusterKey: "123:cats",
            clusterName: "cats",
          },
        ],
      },
      "2026-05-07T19:00:00.000Z",
    );

    expect(result.rows).toHaveLength(1);
    expect(result.querySearchIndex).toEqual({});
    expect(result.filterCounts).toEqual({
      all: 1,
      active: 0,
      excluded: 0,
    });
  });

  it("normalizes legacy cluster query snapshots without queries array", () => {
    const result = normalizeWorkspaceClusterQueriesSnapshot(
      {
        checkedAt: "2026-05-07T19:00:00.000Z",
      },
      "2026-05-07T19:00:00.000Z",
    );

    expect(result).toEqual({
      checkedAt: "2026-05-07T19:00:00.000Z",
      queries: [],
    });
  });
});
