import { describe, expect, it } from "vitest";

import { getVerticalWindowingState } from "./verticalWindowingMath";

describe("getVerticalWindowingState", () => {
  it("keeps visible rows available when scrollTop exceeds the table height", () => {
    const result = getVerticalWindowingState({
      rowCount: 207,
      rowHeight: 44,
      viewportHeight: 620,
      overscanRows: 18,
      scrollTop: 50_000,
    });

    expect(result.startRowIndex).toBeLessThan(207);
    expect(result.endRowIndex).toBeGreaterThan(result.startRowIndex);
    expect(result.endRowIndex).toBe(207);
  });

  it("returns an empty window for empty datasets", () => {
    expect(
      getVerticalWindowingState({
        rowCount: 0,
        rowHeight: 44,
        viewportHeight: 620,
        overscanRows: 18,
        scrollTop: 999,
      }),
    ).toMatchObject({
      startRowIndex: 0,
      endRowIndex: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      clampedScrollTop: 0,
    });
  });
});
