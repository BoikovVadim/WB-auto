import { Module } from "@nestjs/common";

import { WbClustersWriteGuard } from "../common/guards/wb-clusters-write.guard";
import { WbRuntimeConfigModule } from "../wb-runtime-config/wb-runtime-config.module";
import { WbApiClient } from "../wb-sync/wb-api.client";
import { WbCabinetPrivateApiClient } from "./wb-cabinet-private-api.client";
import { WbCmpSafariClient } from "./wb-cmp-safari.client";
import { WbSellerPortalPlaywrightClient } from "./wb-seller-portal-playwright.client";
import { WbClustersController } from "./wb-clusters.controller";
import { UnitEconomicsController } from "./unit-economics.controller";
import { WbClustersActionQueueService } from "./wb-clusters-action-queue.service";
import { WbClustersBidQueueService } from "./wb-clusters-bid-queue.service";
import { WbClustersRepository } from "./wb-clusters.repository";
import { WbClustersScheduler } from "./wb-clusters.scheduler";
import { WbClustersSyncOrchestratorService } from "./wb-clusters-sync-orchestrator.service";
import { WbClustersService } from "./wb-clusters.service";
import { ProductPresetSnapshotOrchestratorService } from "./product-preset-snapshot-orchestrator.service";
import { ProductAdvertisingReadRepository } from "./product-advertising-read.repository";
import { ProductAdvertisingSnapshotBackfillService } from "./product-advertising-snapshot.backfill.service";
import { ProductAdvertisingSnapshotJobService } from "./product-advertising-snapshot-job.service";
import { ProductAdvertisingSnapshotMaterializer } from "./product-advertising-snapshot.materializer";
import { ProductAdvertisingSnapshotRepository } from "./product-advertising-snapshot.repository";
import { ProductAdvertisingSnapshotResolver } from "./product-advertising-snapshot.resolver";
import { ProductCatalogService } from "./product-catalog.service";
import { UnitEconomicsService } from "./unit-economics.service";
import { ProductAdvertisingWorkspaceReadService } from "./product-advertising-workspace-read.service";
import { ProductWorkspaceRepository } from "./product-workspace.repository";
import { ProductWorkspaceSnapshotBackfillService } from "./product-workspace-snapshot.backfill.service";
import { ProductWorkspaceSnapshotMaterializer } from "./product-workspace-snapshot.materializer";
import { ProductWorkspaceSnapshotResolver } from "./product-workspace-snapshot.resolver";
import { PromotionSyncRepository } from "./promotion-sync.repository";
import { WbClustersCabinetService } from "./wb-clusters-cabinet.service";
import { WbClustersSchemaInitService } from "./wb-clusters.schema-init.service";
import { WbPromotionApiClient } from "./wb-promotion-api.client";

@Module({
  imports: [WbRuntimeConfigModule],
  controllers: [WbClustersController, UnitEconomicsController],
  providers: [
    WbCabinetPrivateApiClient,
    WbCmpSafariClient,
    WbSellerPortalPlaywrightClient,
    WbClustersWriteGuard,
    WbClustersCabinetService,
    WbClustersSchemaInitService,
    ProductPresetSnapshotOrchestratorService,
    WbClustersActionQueueService,
    WbClustersBidQueueService,
    WbClustersRepository,
    WbClustersScheduler,
    WbClustersSyncOrchestratorService,
    WbClustersService,
    ProductAdvertisingReadRepository,
    PromotionSyncRepository,
    ProductAdvertisingSnapshotRepository,
    ProductAdvertisingSnapshotResolver,
    ProductAdvertisingSnapshotMaterializer,
    ProductAdvertisingSnapshotJobService,
    ProductAdvertisingSnapshotBackfillService,
    ProductCatalogService,
    UnitEconomicsService,
    ProductAdvertisingWorkspaceReadService,
    ProductWorkspaceRepository,
    ProductWorkspaceSnapshotMaterializer,
    ProductWorkspaceSnapshotResolver,
    ProductWorkspaceSnapshotBackfillService,
    WbApiClient,
    WbPromotionApiClient,
  ],
  exports: [WbClustersService, ProductCatalogService, UnitEconomicsService],
})
export class WbClustersModule {}
