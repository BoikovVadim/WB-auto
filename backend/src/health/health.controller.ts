import { Controller, Get } from "@nestjs/common";

import { appEnv } from "../common/env";

@Controller("health")
export class HealthController {
  @Get()
  getHealth() {
    return {
      status: "ok",
      service: "wb-automation-backend",
      environment: appEnv.nodeEnv,
      uptimeSeconds: Math.floor(process.uptime()),
      checks: {
        wbApiConfigured: Boolean(appEnv.wbApiToken),
        wbPromotionApiConfigured: Boolean(appEnv.wbPromotionApiToken),
        postgresConfigured: appEnv.postgres.enabled,
        writeGuardConfigured: Boolean(appEnv.wbClustersWriteApiKey),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
