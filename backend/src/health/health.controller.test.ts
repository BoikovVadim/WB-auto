import { describe, expect, it } from "vitest";

import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("returns a machine-readable health payload", () => {
    const controller = new HealthController();

    const health = controller.getHealth();

    expect(health.status).toBe("ok");
    expect(health.service).toBe("wb-automation-backend");
    expect(typeof health.environment).toBe("string");
    expect(typeof health.uptimeSeconds).toBe("number");
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(health.checks).toEqual({
      wbApiConfigured: expect.any(Boolean),
      wbPromotionApiConfigured: expect.any(Boolean),
      postgresConfigured: expect.any(Boolean),
      writeGuardConfigured: expect.any(Boolean),
      automationReadOnly: expect.any(Boolean),
    });
    expect(Number.isNaN(Date.parse(health.timestamp))).toBe(false);
  });
});
