import { describe, expect, it } from "vitest";

import {
  buildProductAdvertisingSheetCacheKey,
  buildProductAdvertisingSheetRequestKey,
  normalizeProductAdvertisingSheetRequestInput,
} from "./productAdvertisingSheetIdentity";

describe("product advertising sheet identity", () => {
  it("normalizes whitespace and ignores export request id", () => {
    expect(
      normalizeProductAdvertisingSheetRequestInput({
        startDate: " 2024-01-01 ",
        endDate: " 2024-01-31 ",
        exportRequestId: "legacy-export-id",
      }),
    ).toEqual({
      startDate: "2024-01-01",
      endDate: "2024-01-31",
    });
  });

  it("builds canonical cache and request keys from the same identity", () => {
    const request = {
      startDate: " 2024-02-01 ",
      endDate: "2024-02-29  ",
      exportRequestId: "ignored",
    };

    expect(buildProductAdvertisingSheetCacheKey(42, request)).toBe(
      "wb-dashboard-product-advertising-sheet:42:2024-02-01:2024-02-29",
    );
    expect(buildProductAdvertisingSheetRequestKey(42, request)).toBe(
      "42:2024-02-01:2024-02-29",
    );
  });

  it("falls back to empty range parts for missing input", () => {
    expect(buildProductAdvertisingSheetCacheKey(7)).toBe(
      "wb-dashboard-product-advertising-sheet:7::",
    );
    expect(buildProductAdvertisingSheetRequestKey(7)).toBe("7::");
  });
});
