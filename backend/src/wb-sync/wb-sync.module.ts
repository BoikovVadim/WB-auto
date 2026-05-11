import { Module } from "@nestjs/common";

import { WbClustersModule } from "../wb-clusters/wb-clusters.module";
import { WbRuntimeConfigModule } from "../wb-runtime-config/wb-runtime-config.module";
import { WbSyncController } from "./wb-sync.controller";
import { WbApiClient } from "./wb-api.client";
import { WbProductSearchTextsRangeService } from "./wb-product-search-texts-range.service";
import { WbSearchQueriesExportService } from "./wb-search-queries-export.service";
import { WbSyncExportHistoryService } from "./wb-sync-export-history.service";
import { WbSyncExportMethodStateService } from "./wb-sync-export-method-state.service";
import { WbSyncExportOrchestratorService } from "./wb-sync-export-orchestrator.service";
import { WbSyncService } from "./wb-sync.service";

@Module({
  imports: [WbRuntimeConfigModule, WbClustersModule],
  controllers: [WbSyncController],
  providers: [
    WbApiClient,
    WbProductSearchTextsRangeService,
    WbSearchQueriesExportService,
    WbSyncExportHistoryService,
    WbSyncExportMethodStateService,
    WbSyncExportOrchestratorService,
    WbSyncService,
  ],
  exports: [WbSyncService],
})
export class WbSyncModule {}
