import { Body, Controller, Delete, Get, HttpCode, Inject, Logger, Param, ParseIntPipe, Post, Put, Query, UseGuards } from "@nestjs/common";

import { WbClustersWriteGuard } from "../common/guards/wb-clusters-write.guard";
import { ApplyProductClusterBidDto } from "./dto/apply-product-cluster-bid.dto";
import { ApplyProductClusterActionDto } from "./dto/apply-product-cluster-action.dto";
import { BootstrapWbCabinetSessionDto } from "./dto/bootstrap-wb-cabinet-session.dto";
import { UpdateSellerPortalSessionDto } from "./dto/update-seller-portal-session.dto";
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
import { SetProductCostPriceDto } from "./dto/set-product-cost-price.dto";
import { ProductCatalogService } from "./product-catalog.service";
import { WbClustersCabinetService } from "./wb-clusters-cabinet.service";
import { WbSellerPortalPlaywrightClient } from "./wb-seller-portal-playwright.client";
import { WbClustersService } from "./wb-clusters.service";

@Controller("wb-clusters")
export class WbClustersController {
  private readonly logger = new Logger(WbClustersController.name);

  constructor(
    @Inject(WbClustersService)
    private readonly wbClustersService: WbClustersService,
    @Inject(ProductCatalogService)
    private readonly productCatalogService: ProductCatalogService,
    @Inject(WbClustersCabinetService)
    private readonly wbClustersCabinetService: WbClustersCabinetService,
    @Inject(WbSellerPortalPlaywrightClient)
    private readonly wbSellerPortalPlaywrightClient: WbSellerPortalPlaywrightClient,
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

  @Post("seller-portal/session/update")
  @UseGuards(WbClustersWriteGuard)
  async updateSellerPortalSession(@Body() body: UpdateSellerPortalSessionDto) {
    await this.wbSellerPortalPlaywrightClient.updateSession(body.localStorage);
    return { accepted: true, itemCount: body.localStorage.length };
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

  @Get("jam/backfill-queue")
  getJamBackfillQueueStatus() {
    return this.wbClustersService.getJamBackfillQueueStatus();
  }

  @Get("jam/snapshot/:nmId")
  getJamSnapshotDetails(@Param("nmId", ParseIntPipe) nmId: number) {
    return this.wbClustersService.getJamSnapshotDetails(nmId);
  }

  @Post("jam/backfill")
  @UseGuards(WbClustersWriteGuard)
  handleJamBackfill() {
    return this.wbClustersService.handleJamBackfill();
  }

  @Post("jam/sync/:nmId")
  @UseGuards(WbClustersWriteGuard)
  handleJamSyncForNmId(@Param("nmId", ParseIntPipe) nmId: number) {
    return this.wbClustersService.handleJamSyncForNmId(nmId);
  }

  @Post("sync")
  @UseGuards(WbClustersWriteGuard)
  runSync(@Body() body: RunClusterSyncDto) {
    return this.wbClustersService.runSync(body.trigger ?? "manual", body.mode ?? "full");
  }

  @Post("sync/monthly-frequency")
  @UseGuards(WbClustersWriteGuard)
  runMonthlyFrequencySyncNow() {
    return this.wbClustersService.runMonthlyFrequencySyncNow();
  }

  @Post("sync/frequency-cache-bust")
  @UseGuards(WbClustersWriteGuard)
  clearFrequencyCaches() {
    return this.wbClustersService.clearAllFrequencyCaches();
  }

  @Post("stats/backfill")
  @UseGuards(WbClustersWriteGuard)
  runStatsHistoricalBackfill() {
    return this.wbClustersService.runStatsHistoricalBackfill();
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
      clusterNameSearch: query.clusterNameSearch,
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

  @Get("raw/jam-rows")
  getRawJamRows(
    @Query("nmId") nmId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedNmId = nmId != null ? Number(nmId) : undefined;
    // When nmId is provided we return ALL rows for that product (no artificial cap).
    // Without nmId the result set can be huge, so we apply a safety cap of 2000.
    const resolvedLimit =
      parsedNmId != null ? undefined : Math.min(Number(limit) || 2000, 2000);
    return this.wbClustersService.getRawJamRows({
      nmId: parsedNmId,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      limit: resolvedLimit,
    });
  }

  @Get("raw/campaigns")
  getRawCampaigns(@Query("limit") limit?: string) {
    return this.wbClustersService.getRawCampaigns(Math.min(Number(limit) || 500, 2000));
  }

  @Get("raw/campaign-products")
  getRawCampaignProducts(
    @Query("nmId") nmId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.wbClustersService.getRawCampaignProducts({
      nmId: nmId != null ? Number(nmId) : undefined,
      limit: Math.min(Number(limit) || 500, 2000),
    });
  }

  @Get("raw/sync-runs")
  getRawSyncRuns(@Query("limit") limit?: string) {
    return this.wbClustersService.getRawSyncRuns(Math.min(Number(limit) || 100, 500));
  }

  @Get("raw/cluster-stats")
  getRawClusterStats(
    @Query("nmId") nmId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.wbClustersService.getRawClusterStats({
      nmId: nmId != null ? Number(nmId) : undefined,
      limit: Math.min(Number(limit) || 500, 2000),
    });
  }

  @Get("raw/daily-stats")
  getRawDailyStats(
    @Query("nmId") nmId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.wbClustersService.getRawDailyStats({
      nmId: nmId != null ? Number(nmId) : undefined,
      limit: Math.min(Number(limit) || 1000, 5000),
    });
  }

  @Get("raw/minus-phrases")
  getRawMinusPhrases(
    @Query("nmId") nmId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.wbClustersService.getRawMinusPhrases({
      nmId: nmId != null ? Number(nmId) : undefined,
      limit: Math.min(Number(limit) || 1000, 5000),
    });
  }

  @Get("raw/query-frequencies")
  getRawQueryFrequencies(
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("search") search?: string,
    @Query("sortBy") sortBy?: string,
    @Query("dir") dir?: string,
  ) {
    const parsedOffset = offset != null ? Number(offset) : undefined;
    if (parsedOffset != null) {
      const validSortBy =
        sortBy === "query_text" || sortBy === "subject_name" ? sortBy : "monthly_frequency";
      const validDir = dir === "asc" ? "asc" : "desc";
      return this.wbClustersService.getQueryFrequenciesPaginated({
        limit: Math.min(Number(limit) || 100, 500),
        offset: parsedOffset,
        search: search?.trim() || null,
        sortBy: validSortBy,
        sortDir: validDir,
      });
    }
    return this.wbClustersService.getRawQueryFrequencies(Math.min(Number(limit) || 300_000, 300_000));
  }

  @Get("raw/query-frequency-history/weeks")
  getFrequencyHistoryWeeks() {
    return this.wbClustersService.getFrequencyHistoryWeeks();
  }

  @Get("raw/query-frequency-history")
  getRawQueryFrequencyHistory(
    @Query("week") week?: string,
    @Query("limit") limit?: string,
  ) {
    return this.wbClustersService.getRawQueryFrequencyHistory({
      week: week ?? null,
      limit: Math.min(Number(limit) || 2000, 10000),
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

  @Get("products/:nmId/campaigns/:advertId/clusters/change-log")
  getClusterChangeLog(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Param("advertId", ParseIntPipe) advertId: number,
  ) {
    return this.wbClustersService.getClusterChangeLog(nmId, advertId);
  }

  @Get("products/cost-prices")
  getAllCostPrices() {
    return this.wbClustersService.getAllCostPrices();
  }

  @Get("products/cost-price-matrix")
  getCostPriceMatrix() {
    return this.wbClustersService.getCostPriceMatrix();
  }

  @Get("change-log")
  getUnifiedChangeLog(@Query("limit") limit?: string) {
    // Clamp to a sane cap and coerce NaN/0/negative back to the default.
    return this.wbClustersService.getUnifiedChangeLog(Math.min(Number(limit) || 500, 2000));
  }

  @Get("products/orders-today")
  getTodayOrderCounts() {
    return this.wbClustersService.getTodayOrderCounts();
  }

  @Get("products/orders-matrix")
  getOrdersMatrix() {
    return this.wbClustersService.getOrdersMatrix();
  }

  /** Downloads Analytics CSV report (7 days), stores in wb_product_daily_orders. */
  @Post("products/sync-orders")
  @UseGuards(WbClustersWriteGuard)
  triggerOrdersSync() {
    this.wbClustersService.syncOrdersFromAnalytics(6).catch((error: unknown) => {
      this.logger.error("Background syncOrdersFromAnalytics failed", error);
    });
    return { status: "started", mode: "csv-7-days" };
  }

  @Get("products/latest-stocks")
  getLatestStocks() {
    return this.wbClustersService.getLatestStocks();
  }

  @Get("products/stocks-matrix")
  getStocksMatrix() {
    return this.wbClustersService.getStocksMatrix();
  }

  /** Triggers a stock snapshot download from WB Statistics API. */
  @Post("products/sync-stocks")
  @UseGuards(WbClustersWriteGuard)
  triggerStocksSync() {
    this.wbClustersService.syncStocksSnapshot().catch((error: unknown) => {
      this.logger.error("Background syncStocksSnapshot failed", error);
    });
    return { status: "started" };
  }

  // ─── JAM daily read-model ────────────────────────────────────────────────────

  /** Latest JAM position per product (most recent jam_date). */
  @Get("products/jam-positions")
  getLatestJamPositions() {
    return this.wbClustersService.getLatestJamPositions();
  }

  /** All JAM daily rows for all products. Used for retrospective matrix. */
  @Get("products/jam-matrix")
  getJamDailyMatrix() {
    return this.wbClustersService.getJamDailyMatrix();
  }

  /** Manually trigger JAM daily materialization for today (after manual JAM backfill). */
  @Post("products/jam-materialize")
  @UseGuards(WbClustersWriteGuard)
  triggerJamMaterialize() {
    this.wbClustersService.materializeJamDaily(0).catch((error: unknown) => {
      this.logger.error("Background materializeJamDaily failed", error);
    });
    return { status: "started" };
  }

  /**
   * Backfill JAM daily read-model for the entire current calendar month.
   * Run once after initial setup; safe to re-run (idempotent ON CONFLICT DO UPDATE).
   */
  @Post("products/jam-backfill-month")
  @UseGuards(WbClustersWriteGuard)
  async triggerJamBackfillMonth() {
    const rows = await this.wbClustersService.materializeJamDailyForMonth();
    return { status: "done", rowsWritten: rows };
  }

  /**
   * Returns summed JAM metrics for a single product over a date range.
   * Used by the advertising cluster view date-range JAM panel.
   * Query params: from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  @Get("products/:nmId/jam-summary")
  getJamSummaryForProduct(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    return this.wbClustersService.getJamDailySummaryForProduct(nmId, from, to);
  }

  @Get("products/:nmId/cost-price-history")
  getCostPriceHistory(@Param("nmId", ParseIntPipe) nmId: number) {
    return this.wbClustersService.getCostPriceHistory(nmId);
  }

  @Put("products/:nmId/cost-price")
  @UseGuards(WbClustersWriteGuard)
  setProductCostPrice(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Body() body: SetProductCostPriceDto,
  ) {
    return this.wbClustersService.setProductCostPrice(nmId, body.costValue);
  }

  @Delete("products/:nmId/cost-price")
  @UseGuards(WbClustersWriteGuard)
  @HttpCode(204)
  async clearProductCostPrice(@Param("nmId", ParseIntPipe) nmId: number) {
    await this.wbClustersService.clearProductCostPrice(nmId);
  }

  @Get("products/:nmId/refresh/:syncRunId")
  getProductAdvertisingRefreshStatus(
    @Param("nmId", ParseIntPipe) nmId: number,
    @Param("syncRunId") syncRunId: string,
  ) {
    return this.wbClustersService.getProductAdvertisingRefreshStatus(nmId, syncRunId);
  }
}
