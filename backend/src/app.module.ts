import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { HealthModule } from "./health/health.module";
import { WbClustersModule } from "./wb-clusters/wb-clusters.module";
import { WbRuntimeConfigModule } from "./wb-runtime-config/wb-runtime-config.module";
import { WbSyncModule } from "./wb-sync/wb-sync.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    WbRuntimeConfigModule,
    HealthModule,
    WbSyncModule,
    WbClustersModule,
  ],
})
export class AppModule {}
