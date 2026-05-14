import { afterEach, describe, expect, it } from "vitest";

import {
  _resetWorkspaceCacheForTests,
  cacheProductWorkspace,
  getCachedProductWorkspace,
  invalidateCachedProductWorkspace,
} from "./productWorkspaceCache";

afterEach(() => {
  _resetWorkspaceCacheForTests();
});

describe("productWorkspaceCache core behavior", () => {
  it("returns null when nothing is cached", () => {
    expect(getCachedProductWorkspace(999, { startDate: "2026-05-01", endDate: "2026-05-07" })).toBeNull();
  });

  it("returns workspace after caching with exact date match", () => {
    const workspace = { nmId: 123 } as never;
    cacheProductWorkspace(123, { startDate: "2026-05-01", endDate: "2026-05-07" }, workspace);
    const result = getCachedProductWorkspace(123, { startDate: "2026-05-01", endDate: "2026-05-07" });
    expect(result).not.toBeNull();
    expect(result?.nmId).toBe(123);
  });

  it("returns null for different dates (no fallback in memory-only mode)", () => {
    const workspace = { nmId: 456 } as never;
    cacheProductWorkspace(456, { startDate: "2026-05-01", endDate: "2026-05-07" }, workspace);
    const result = getCachedProductWorkspace(456, { startDate: "2026-05-02", endDate: "2026-05-08" });
    expect(result).toBeNull();
  });

  it("returns null after invalidation", () => {
    const workspace = { nmId: 789 } as never;
    cacheProductWorkspace(789, { startDate: "2026-05-01", endDate: "2026-05-07" }, workspace);
    invalidateCachedProductWorkspace(789, { startDate: "2026-05-01", endDate: "2026-05-07" });
    expect(getCachedProductWorkspace(789, { startDate: "2026-05-01", endDate: "2026-05-07" })).toBeNull();
  });
});
