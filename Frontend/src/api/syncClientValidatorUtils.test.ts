import { describe, expect, it } from "vitest";

import {
  isIsoDateString,
  isNonEmptyString,
  isNullableDateOnlyString,
  isSupportedMethod,
} from "./syncClientValidatorUtils";

describe("sync client validator utils", () => {
  it("accepts only non-empty strings after trim", () => {
    expect(isNonEmptyString("value")).toBe(true);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isNonEmptyString(42)).toBe(false);
  });

  it("accepts ISO date strings and rejects invalid dates", () => {
    expect(isIsoDateString("2024-05-07T10:20:30.000Z")).toBe(true);
    expect(isIsoDateString("not-a-date")).toBe(false);
    expect(isIsoDateString("")).toBe(false);
  });

  it("accepts nullable date-only filters in yyyy-mm-dd format", () => {
    expect(isNullableDateOnlyString(null)).toBe(true);
    expect(isNullableDateOnlyString("2024-05-07")).toBe(true);
    expect(isNullableDateOnlyString("07-05-2024")).toBe(false);
  });

  it("keeps supported transport methods explicit", () => {
    expect(isSupportedMethod("GET")).toBe(true);
    expect(isSupportedMethod("POST")).toBe(true);
    expect(isSupportedMethod("PATCH")).toBe(false);
  });
});
