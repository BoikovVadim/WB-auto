import { afterEach, describe, expect, it } from "vitest";

import { getOptionalEnv, getRequiredEnv } from "./env";

const originalValue = process.env.WB_AUTOMATION_TEST_ENV;

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env.WB_AUTOMATION_TEST_ENV;
    return;
  }

  process.env.WB_AUTOMATION_TEST_ENV = originalValue;
});

describe("env helpers", () => {
  it("returns the required value when present", () => {
    process.env.WB_AUTOMATION_TEST_ENV = "configured";

    expect(getRequiredEnv("WB_AUTOMATION_TEST_ENV")).toBe("configured");
  });

  it("throws for missing required values", () => {
    delete process.env.WB_AUTOMATION_TEST_ENV;

    expect(() => getRequiredEnv("WB_AUTOMATION_TEST_ENV")).toThrow(
      "Missing required environment variable: WB_AUTOMATION_TEST_ENV",
    );
  });

  it("returns the fallback for optional values", () => {
    delete process.env.WB_AUTOMATION_TEST_ENV;

    expect(getOptionalEnv("WB_AUTOMATION_TEST_ENV", "fallback")).toBe("fallback");
  });
});
