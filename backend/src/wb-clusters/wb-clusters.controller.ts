import { Body, Controller, Get, Inject, Param, ParseIntPipe, Post, Query, UseGuards } from "@nestjs/common";

import { WbClustersWriteGuard } from "../common/guards/wb-clusters-write.guard";
import { ApplyProductClusterBidDto } from "./dto/apply-product-cluster-bid.dto";
import { ApplyProductClusterActionDto } from "./dto/apply-product-cluster-action.dto";
import { BootstrapWbCabinetSessionDto } from "./dto/bootstrap-wb-cabinet-session.dto";
import { GetProductAdvertisingSheetBundleDto } from "./dto/get-product-advertising-sheet-bundle.dto";
import { GetProductAdvertisingSheetDto } from "./dto/get-product-advertising-sheet.dto";
import { GetProductWorkspaceClusterQueriesDto } from "./dto/get-product-workspace-cluster-queries.dto";
import { GetProductWorkspaceClusterTableDto } from "./dto/get-product-workspace-cluster-table.dto";
import { GetProductWorkspaceDto } from "./dto/get-product-workspace.dto";
import { GetProductSnapshotReadinessDto } from "./dto/get-product-snapshot-readiness.dto";
import { ImportCabinetQueryMapDto } from "./dto/import-cabinet-query-map.dto";
import { ListCabinetQueryMapCandidatesDto } from "./dto/list-cabinet-query-map-candidates.dto";
import { LookupProductClustersDto } from "./dto/lookup-product-clusters.dto";
import { MaterializeProductAdvertisingSheetsDto } from "./dto/materialize-product-advertising-sheets.dto";
import { ProbeWbCabinetCmpDto } from "./dto/probe-wb-cabinet-cmp.dto";
import { RunClusterSyncDto } from "./dto/run-cluster-sync.dto";
import { ProductCatalogService } from "./product-catalog.service";
import { WbClustersCabinetService } from "./wb-clusters-cabinet.service";
import { WbClustersService } from "./wb-clusters.service";

@Controller("wb-clusters")
export class WbClustersController {
  constructor(
    @Inject(WbClustersService)
    private readonly wbClustersService: WbClustersService,
    @Inject(ProductCatalogService)
    private readonly productCatalogService: ProductCatalogService,
    @Inject(WbClustersCabinetService)
    private readonly wbClustersCabinetService: WbClustersCabinetService,
  ) {}

  @Get("status")
  getStatus() {
    return this.wbClustersService.getStatus();
  }

  @Get("cabinet/status")
  getCabinetStatus() {
    return this.wbClustersCabinetService.getCabinetStatus();
  }

  @Post("cabinet/session/bootstrap")
  @UseGuards(WbClustersWriteGuard)
  bootstrapCabinetSession(@Body() body: BootstrapWbCabinetSessionDto) {
    return this.wbClustersCabinetService.bootstrapCabinetSession(body.storageStateJson);
  }

  @Post("cabinet/probe")
  @UseGuards(WbClustersWriteGuard)
  probeCabinetCmp(@Body() body: ProbeWbCabinetCmpDto) {
    return this.wbClustersCabinetService.probeCabinetCmp(body.advertId, body.nmId);
  }

  @Get("cabinet/query-map/candidates")
  getCabinetQueryMapCandidates(@Query() query: ListCabinetQueryMapCandidatesDto) {
    return this.wbClustersCabinetService.getCabinetQueryMapImportCandidates({
      limit: query.limit,
      mode: query.mode,
    });
  }

  @Post("cabinet/query-map/import")
  @UseGuards(WbClustersWriteGuard)
  importCabinetQueryMap(@Body() body: ImportCabinetQueryMapDto) {
    return this.wbClustersCabinetService.importCabinetQueryMap({
      advertId: body.advertId,
      nmId: body.nmId,
      capturedAt: body.capturedAt,
      captureMode: body.captureMode,
      sourceEndpoint: body.sourceEndpoint,
      replaceExisting: body.replaceExisting,
      rows: body.rows,
    });
  }

  @Post("jam/backfill")
  @UseGuards(WbClustersWriteGuard)
  handleJamBackfill() {
    return this.wbClustersService.handleJamBackfill();
  }

  @Post("sync")
  @UseGuards(WbClustersWriteGuard)
  runSync(@Body() body: RunClusterSyncDto) {
    return this.wbClustersService.runSync(body.trigger ?? "manual", body.mode ?? "full");
  }

  @Post("products/:nmId/lookup")
  lookupProductClusters(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Body() body: LookupProductClustersDto,
  ) {
    return this.wbClustersService.lookupProductClusters(nmId, body.queries);
  }

  @Get("products/:nmId/advertising-sheet")
  getProductAdvertisingSheet(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Query() query: GetProductAdvertisingSheetDto,
  ) {
    return this.wbClustersService.getProductAdvertisingSheet(nmId, {
      startDate: query.startDate,
      endDate: query.endDate,
    });
  }

  @Get("products/:nmId/workspace")
  getProductWorkspace(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Query() query: GetProductWorkspaceDto,
  ) {
    return this.wbClustersService.getProductAdvertisingWorkspace(nmId, {
      startDate: query.startDate,
      endDate: query.endDate,
    });
  }

  @Get("products/:nmId/workspace-bundle")
  getProductWorkspaceBundle(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Query() query: GetProductWorkspaceDto,
  ) {
    return this.wbClustersService.getProductAdvertisingWorkspaceBundle(nmId, {
      startDate: query.startDate,
      endDate: query.endDate,
    });
  }

  @Get("products/:nmId/campaigns/:advertId/workspace-cluster-table")
  getProductWorkspaceClusterTable(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Param("advertId", ParseIntPipe) advertId: number,
    @Query() query: GetProductWorkspaceClusterTableDto,
  ) {
    return this.wbClustersService.getProductAdvertisingWorkspaceClusterTable(nmId, advertId, {
      startDate: query.startDate,
      endDate: query.endDate,
      status: query.status,
      search: query.search,
      numericFilters: query.numericFilters,
      sortKey: query.sortKey,
      sortDirection: query.sortDirection,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get("products/:nmId/campaigns/:advertId/workspace-cluster-queries")
  getProductWorkspaceClusterQueries(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Param("advertId", ParseIntPipe) advertId: number,
    @Query() query: GetProductWorkspaceClusterQueriesDto,
  ) {
    return this.wbClustersService.getProductAdvertisingWorkspaceClusterQueries(nmId, advertId, {
      clusterKey: query.clusterKey,
      clusterName: query.clusterName,
      startDate: query.startDate,
      endDate: query.endDate,
      sortKey: query.sortKey,
      sortDirection: query.sortDirection,
    });
  }

  @Get("products/catalog")
  getProductCatalog() {
    return this.productCatalogService.getProductCatalog();
  }

  @Post("products/advertising-sheet-bundle")
  getProductAdvertisingSheetBundle(@Body() body: GetProductAdvertisingSheetBundleDto) {
    return this.wbClustersService.getProductAdvertisingSheetBundle({
      nmIds: body.nmIds,
      startDate: body.startDate,
      endDate: body.endDate,
    });
  }

  @Post("products/advertising-sheet-readiness")
  getProductAdvertisingSheetReadiness(@Body() body: GetProductSnapshotReadinessDto) {
    return this.wbClustersService.getProductAdvertisingSheetReadiness({
      nmIds: body.nmIds,
      startDate: body.startDate,
      endDate: body.endDate,
      exportRequestId: body.exportRequestId,
    });
  }

  @Post("products/materialize")
  @UseGuards(WbClustersWriteGuard)
  materializeProductAdvertisingSheets(@Body() body: MaterializeProductAdvertisingSheetsDto) {
    return this.wbClustersService.materializeProductAdvertisingSheetsForNmIds(
      body.nmIds,
      body.reason,
      body.exportRequestId,
      body.startDate,
      body.endDate,
      body.priority,
    );
  }

  @Post("products/:nmId/refresh")
  @UseGuards(WbClustersWriteGuard)
  refreshProductAdvertising(@Param("nmId", ParseIntPipe) nmId: number) {
    return this.wbClustersService.refreshProductAdvertising(nmId);
  }

  @Post("products/:nmId/campaigns/:advertId/clusters/action")
  @UseGuards(WbClustersWriteGuard)
  applyProductClusterAction(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Param("advertId", ParseIntPipe) advertId: number,
    @Body() body: ApplyProductClusterActionDto,
  ) {
    return this.wbClustersService.applyProductClusterAction(
      nmId,
      advertId,
      body.action,
      body.clusterNames,
    );
  }

  @Post("products/:nmId/campaigns/:advertId/clusters/bids")
  @UseGuards(WbClustersWriteGuard)
  applyProductClusterBids(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Param("advertId", ParseIntPipe) advertId: number,
    @Body() body: ApplyProductClusterBidDto,
  ) {
    return this.wbClustersService.applyProductClusterBids(
      nmId,
      advertId,
      body.bids,
    );
  }

  @Get("products/:nmId/refresh/:syncRunId")
  getProductAdvertisingRefreshStatus(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Param("syncRunId") syncRunId: string,
  ) {
    return this.wbClustersService.getProductAdvertisingRefreshStatus(nmId, syncRunId);
  }
}
