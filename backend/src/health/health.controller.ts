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
        // Observe-режим: true → автодвижки в кабинет WB не пишут (shadow). Видно в health,
        // чтобы удалённо подтверждать observe на новом экземпляре при миграции в Oqqi.
        automationReadOnly: appEnv.wbAutomationReadOnly,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
