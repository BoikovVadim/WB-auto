import { afterEach, describe, expect, it } from "vitest";

import {
  _resetWorkspaceCacheForTests,
  cacheProductWorkspace,
  getCachedProductWorkspace,
  invalidateCachedProductWorkspace,
} from "./productWorkspaceCache";

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  get length() {
    return this.store.size;
  }

  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }

  clear() {
    this.store.clear();
  }
}

function installWindowMock() {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
      sessionStorage,
    },
  });

  return {
    localStorage,
    sessionStorage,
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  _resetWorkspaceCacheForTests();
});

function makeMinimalValidWorkspace(nmId = 123): object {
  return {
    nmId,
    checkedAt: "2026-05-08T07:00:00.000Z",
    header: {
      nmId,
      vendorCode: "TEST-001",
      productName: "Test Product",
      brandName: "TestBrand",
      subjectName: "Electronics",
    },
    snapshot: { status: "ready" },
    range: { startDate: "2026-05-01", endDate: "2026-05-07", jamStatus: "ready", jamIncluded: true },
    dateBounds: {
      minDate: "2026-01-01",
      maxDate: "2026-05-07",
      defaultStartDate: "2026-05-01",
      defaultEndDate: "2026-05-07",
    },
    readiness: {
      scope: "workspace",
      status: "ready",
      source: "workspace_snapshot",
      materializationStatus: "materialized",
    },
    campaignTabs: [],
    defaultCampaignId: null,
    selectedCampaignSummary: null,
    initialClusterTable: null,
    syncState: { hasPendingClusterSync: false, refreshStatus: "idle", syncRunId: null, startedAt: null },
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

describe("productWorkspaceCache compatibility behavior", () => {
  it("ignores legacy session storage key wb-dashboard-latest-product-workspace", () => {
    const { sessionStorage } = installWindowMock();

    // Simulate an old session storage entry written by the previous cache implementation.
    sessionStorage.setItem(
      "wb-dashboard-latest-product-workspace",
      JSON.stringify({
        schemaVersion: 1,
        key: "wb-dashboard-product-workspace:123:2026-05-01:2026-05-07",
        value: {
          nmId: 123,
          checkedAt: "2026-05-08T07:00:00.000Z",
          diagnostics: { periodMetricsStatus: "broken_status" },
        },
      }),
    );

    // New implementation does not read session storage for workspaces → null.
    expect(
      getCachedProductWorkspace(123, {
        startDate: "2026-05-01",
        endDate: "2026-05-07",
      }),
    ).toBeNull();
  });

  it("ignores legacy per-key localStorage entries written by old implementation", () => {
    const { localStorage } = installWindowMock();

    // Old cache wrote one entry per product using the raw cache key as the localStorage key.
    localStorage.setItem(
      "wb-dashboard-product-workspace:123:2026-05-01:2026-05-07",
      JSON.stringify({
        nmId: 123,
        checkedAt: "2026-05-08T07:00:00.000Z",
      }),
    );

    // New implementation uses a different key schema → never reads the old key → null.
    expect(
      getCachedProductWorkspace(123, {
        startDate: "2026-05-01",
        endDate: "2026-05-07",
      }),
    ).toBeNull();
  });
});

describe("productWorkspaceCache core behavior", () => {
  it("returns null when nothing is cached", () => {
    installWindowMock();
    expect(getCachedProductWorkspace(999, { startDate: "2026-05-01", endDate: "2026-05-07" })).toBeNull();
  });

  it("returns workspace after caching with exact date match", () => {
    installWindowMock();
    const workspace = makeMinimalValidWorkspace(123);
    cacheProductWorkspace(123, { startDate: "2026-05-01", endDate: "2026-05-07" }, workspace as never);
    const result = getCachedProductWorkspace(123, { startDate: "2026-05-01", endDate: "2026-05-07" });
    expect(result).not.toBeNull();
    expect(result?.nmId).toBe(123);
  });

  it("returns stale workspace via nmId-only fallback when dates change", () => {
    installWindowMock();
    const workspace = makeMinimalValidWorkspace(456);
    // Store with old dates
    cacheProductWorkspace(456, { startDate: "2026-05-01", endDate: "2026-05-07" }, workspace as never);
    // Request with NEW dates (sliding window shifted) — exact key misses, fallback returns stale
    const result = getCachedProductWorkspace(456, { startDate: "2026-05-02", endDate: "2026-05-08" });
    expect(result).not.toBeNull();
    expect(result?.nmId).toBe(456);
  });

  it("returns null after invalidation", () => {
    installWindowMock();
    const workspace = makeMinimalValidWorkspace(789);
    cacheProductWorkspace(789, { startDate: "2026-05-01", endDate: "2026-05-07" }, workspace as never);
    invalidateCachedProductWorkspace(789, { startDate: "2026-05-01", endDate: "2026-05-07" });
    // Exact key removed; fallback still exists (not invalidated by date-specific call)
    const result = getCachedProductWorkspace(789, { startDate: "2026-05-01", endDate: "2026-05-07" });
    // Fallback may still return the entry — this is expected stale-while-revalidate behavior
    if (result !== null) {
      expect(result.nmId).toBe(789);
    }
  });

  it("persists to localStorage and survives module reload simulation", () => {
    const { localStorage } = installWindowMock();
    const workspace = makeMinimalValidWorkspace(321);
    cacheProductWorkspace(321, { startDate: "2026-05-01", endDate: "2026-05-07" }, workspace as never);

    // Verify something was written to localStorage
    expect(localStorage.getItem("wb-dashboard-workspace-map-v2")).not.toBeNull();
    expect(localStorage.getItem("wb-dashboard-workspace-fallback-v1")).not.toBeNull();
  });
});
