import type { SearchQueryTextView } from "../wb-sync/wb-sync.types";
import type {
  PreferredProductAdvertisingSnapshotSummaryRecord,
  ProductAdvertisingSnapshotSummaryRecord,
  ProductPresetSnapshotJobRecordSummary,
} from "./wb-clusters.repository";
import type { ProductAdvertisingSheetJamOverlay } from "./product-advertising-sheet.builder";
import type {
  ProductAdvertisingSheetResponse,
  ProductSnapshotReadinessItem,
  ProductSnapshotReadinessStatus,
  ProductSnapshotWarmupPriority,
} from "./wb-clusters.types";
import * as wb_clusters_read_flow from "./wb-clusters-read-flow";
import type {
  WbClustersMaterializeContext,
  WbClustersSnapshotReadContext,
} from "./wb-clusters.flow-context";
import {
  ProductSnapshotWarmupState,
  WbClustersServiceState,
} from "./wb-clusters.service.state";

export abstract class WbClustersServiceReadInternals extends WbClustersServiceState {
  protected withEmptyJamMetrics(sheet: ProductAdvertisingSheetResponse): ProductAdvertisingSheetResponse {
    return wb_clusters_read_flow.withEmptyJamMetrics(
      this as unknown as WbClustersSnapshotReadContext,
      sheet,
    );
  }

  protected async enrichProductAdvertisingSheetWithJam(
    sheet: ProductAdvertisingSheetResponse,
    nmId: number,
    currentPeriod: { start: string; end: string },
    allowLiveFetch = false,
  ): Promise<ProductAdvertisingSheetResponse> {
    return wb_clusters_read_flow.enrichProductAdvertisingSheetWithJam(
      this as unknown as WbClustersSnapshotReadContext,
      sheet,
      nmId,
      currentPeriod,
      allowLiveFetch,
    );
  }

  protected async getOrLoadProductAdvertisingSheetSnapshot(
    nmId: number,
    currentPeriod: { start: string; end: string },
  ) {
    return wb_clusters_read_flow.getOrLoadProductAdvertisingSheetSnapshot(
      this as unknown as WbClustersSnapshotReadContext,
      nmId,
      currentPeriod,
    );
  }

  protected async materializeProductAdvertisingSheetSnapshot(
    nmId: number,
    currentPeriod: { start: string; end: string },
  ) {
    return wb_clusters_read_flow.materializeProductAdvertisingSheetSnapshot(
      this as unknown as WbClustersSnapshotReadContext,
      nmId,
      currentPeriod,
    );
  }

  protected async getOrLoadProductAdvertisingSheetJamOverlay(
    sheet: ProductAdvertisingSheetResponse,
    nmId: number,
    currentPeriod: { start: string; end: string },
    allowLiveFetch: boolean,
  ) {
    return wb_clusters_read_flow.getOrLoadProductAdvertisingSheetJamOverlay(
      this as unknown as WbClustersSnapshotReadContext,
      sheet,
      nmId,
      currentPeriod,
      allowLiveFetch,
    );
  }

  protected invalidateProductAdvertisingSheetCaches(nmId: number) {
    return wb_clusters_read_flow.invalidateProductAdvertisingSheetCaches(
      this as unknown as WbClustersSnapshotReadContext,
      nmId,
    );
  }

  /**
   * Clears only the JAM search-text overlay cache for a specific product.
   * Unlike invalidateProductAdvertisingSheetCaches, this does NOT bump
   * cacheVersion — so querySearchIndex entries stay valid and no extra DB
   * queries are triggered on the next cluster table request.
   * Use this after a single JAM day sync where only overlay freshness matters.
   */
  protected clearJamSearchTextCacheForNmId(nmId: number) {
    const prefix = `${String(nmId)}:`;
    for (const key of this.productAdvertisingSheetJamCache.keys()) {
      if (key.startsWith(prefix)) {
        this.productAdvertisingSheetJamCache.delete(key);
      }
    }
  }

  protected scheduleProductAdvertisingSheetWarmup(
    nmIds: number[],
    reason: string,
    explicitPeriod?: { start: string; end: string } | null,
    priority: ProductSnapshotWarmupPriority = "background",
  ) {
    return wb_clusters_read_flow.scheduleProductAdvertisingSheetWarmup(
      this as unknown as WbClustersMaterializeContext,
      nmIds,
      reason,
      explicitPeriod,
      priority,
    );
  }

  protected resolveProductAdvertisingSheetSnapshotCacheTtlMs(
    value: ProductAdvertisingSheetResponse,
  ) {
    return wb_clusters_read_flow.resolveProductAdvertisingSheetSnapshotCacheTtlMs(
      this as unknown as WbClustersSnapshotReadContext,
      value,
    );
  }

  protected async materializeProductAdvertisingSheets(
    nmIds: number[],
    reason: string,
    explicitPeriod?: { start: string; end: string } | null,
    exportRequestId?: string | null,
    priority: ProductSnapshotWarmupPriority = "background",
  ) {
    return wb_clusters_read_flow.materializeProductAdvertisingSheets(
      this as unknown as WbClustersMaterializeContext,
      nmIds,
      reason,
      explicitPeriod,
      exportRequestId,
      priority,
    );
  }

  protected resolveProductSnapshotWarmupConcurrency(priority: ProductSnapshotWarmupPriority) {
    return wb_clusters_read_flow.resolveProductSnapshotWarmupConcurrency(
      this as unknown as WbClustersMaterializeContext,
      priority,
    );
  }

  protected buildProductSnapshotWarmupStateKey(input: {
    exportRequestId: string | null;
    period: { start: string; end: string };
    nmId: number;
  }) {
    return wb_clusters_read_flow.buildProductSnapshotWarmupStateKey(this, input);
  }

  protected buildProductSnapshotWarmupJobKey(
    exportRequestId: string,
    period: { start: string; end: string },
    priority: ProductSnapshotWarmupPriority,
  ) {
    return wb_clusters_read_flow.buildProductSnapshotWarmupJobKey(
      this,
      exportRequestId,
      period,
      priority,
    );
  }

  protected markProductSnapshotWarmupQueued(
    nmIds: number[],
    period: { start: string; end: string } | null,
    exportRequestId: string | null,
    priority: ProductSnapshotWarmupPriority,
  ) {
    return wb_clusters_read_flow.markProductSnapshotWarmupQueued(
      this,
      nmIds,
      period,
      exportRequestId,
      priority,
    );
  }

  protected markProductSnapshotWarmupRunning(
    nmIds: number[],
    period: { start: string; end: string },
    exportRequestId: string | null,
  ) {
    return wb_clusters_read_flow.markProductSnapshotWarmupRunning(this, nmIds, period, exportRequestId);
  }

  protected markProductSnapshotWarmupFailed(
    nmIds: number[],
    period: { start: string; end: string },
    exportRequestId: string | null,
    failureReason: string,
  ) {
    return wb_clusters_read_flow.markProductSnapshotWarmupFailed(
      this,
      nmIds,
      period,
      exportRequestId,
      failureReason,
    );
  }

  protected clearProductSnapshotWarmupState(
    nmIds: number[],
    period: { start: string; end: string },
    exportRequestId: string | null,
  ) {
    return wb_clusters_read_flow.clearProductSnapshotWarmupState(this, nmIds, period, exportRequestId);
  }

  protected getProductSnapshotWarmupState(input: {
    nmId: number;
    period: { start: string; end: string };
    exportRequestId: string | null;
  }) {
    return wb_clusters_read_flow.getProductSnapshotWarmupState(this, input);
  }

  protected getWarmupPriorityRank(priority: ProductSnapshotWarmupPriority) {
    return wb_clusters_read_flow.getWarmupPriorityRank(this, priority);
  }

  protected buildProductSnapshotReadinessItem(input: {
    nmId: number;
    currentPeriod: { start: string; end: string };
    exportRequestId: string | null;
    preferredSnapshot: PreferredProductAdvertisingSnapshotSummaryRecord | null;
    presetJob: ProductPresetSnapshotJobRecordSummary | null;
  }): ProductSnapshotReadinessItem {
    return wb_clusters_read_flow.buildProductSnapshotReadinessItem(this, input);
  }

  protected buildSnapshotReadyItem(
    nmId: number,
    status: ProductSnapshotReadinessStatus,
    snapshot: ProductAdvertisingSnapshotSummaryRecord,
    snapshotFit: PreferredProductAdvertisingSnapshotSummaryRecord["fit"],
    snapshotSource: PreferredProductAdvertisingSnapshotSummaryRecord["source"],
    warmupState: ProductSnapshotWarmupState | null,
  ): ProductSnapshotReadinessItem {
    return wb_clusters_read_flow.buildSnapshotReadyItem(
      this,
      nmId,
      status,
      snapshot,
      snapshotFit,
      snapshotSource,
      warmupState,
    ) as ProductSnapshotReadinessItem;
  }

  protected getHourlyProductAdvertisingWarmPeriods() {
    return wb_clusters_read_flow.getHourlyProductAdvertisingWarmPeriods(
      this as unknown as WbClustersMaterializeContext,
    );
  }

  protected async buildProductAdvertisingSheetJamOverlay(
    sheet: ProductAdvertisingSheetResponse,
    nmId: number,
    currentPeriod: { start: string; end: string },
    allowLiveFetch: boolean,
  ): Promise<ProductAdvertisingSheetJamOverlay> {
    return wb_clusters_read_flow.buildProductAdvertisingSheetJamOverlay(
      this as unknown as WbClustersSnapshotReadContext,
      sheet,
      nmId,
      currentPeriod,
      allowLiveFetch,
    );
  }

  protected async loadProductAdvertisingSheetSearchTextsRange(
    nmId: number,
    currentPeriod: { start: string; end: string },
    allowLiveFetch: boolean,
  ) {
    return wb_clusters_read_flow.loadProductAdvertisingSheetSearchTextsRange(
      this,
      nmId,
      currentPeriod,
      allowLiveFetch,
    );
  }

  protected async seedProductAdvertisingSearchTextRangesFromExport(
    exportRequestId: string,
    nmIds: number[],
    explicitPeriod: { start: string; end: string },
  ) {
    return wb_clusters_read_flow.seedProductAdvertisingSearchTextRangesFromExport(
      this,
      exportRequestId,
      nmIds,
      explicitPeriod,
    );
  }

  protected async runExactProductPresetMaterializationFromExport(
    exportRequestId: string,
    nmIds: number[],
    explicitPeriod: { start: string; end: string },
    reason: string,
  ) {
    return wb_clusters_read_flow.runExactProductPresetMaterializationFromExport(
      this,
      exportRequestId,
      nmIds,
      explicitPeriod,
      reason,
    );
  }

  protected deduplicateProductAdvertisingSearchTexts(rows: SearchQueryTextView[]) {
    return wb_clusters_read_flow.deduplicateProductAdvertisingSearchTexts(this, rows);
  }

  protected normalizeAdvertisingSheetJamRange(startDate: string, endDate: string) {
    return wb_clusters_read_flow.normalizeAdvertisingSheetJamRange(this, startDate, endDate);
  }

  protected buildAdvertisingSheetSearchQueriesPeriod(currentPeriod: {
    start: string;
    end: string;
  }) {
    return wb_clusters_read_flow.buildAdvertisingSheetSearchQueriesPeriod(this, currentPeriod);
  }

  protected formatAdvertisingSheetDate(value: Date) {
    return wb_clusters_read_flow.formatAdvertisingSheetDate(this, value);
  }

  protected addAdvertisingSheetDays(value: Date, days: number) {
    return wb_clusters_read_flow.addAdvertisingSheetDays(this, value, days);
  }

  protected parseAdvertisingSheetDayValue(value: string) {
    return wb_clusters_read_flow.parseAdvertisingSheetDayValue(this, value);
  }

  protected getAdvertisingSheetStartOfDayTimestamp(value: Date) {
    return wb_clusters_read_flow.getAdvertisingSheetStartOfDayTimestamp(this, value);
  }

  protected readOptionalString(value: unknown) {
    return wb_clusters_read_flow.readOptionalString(this, value);
  }

  protected normalizeSearchBidFromWb(value: unknown) {
    return wb_clusters_read_flow.normalizeSearchBidFromWb(this, value);
  }

  protected toNullableNumber(value: unknown) {
    return wb_clusters_read_flow.toNullableNumber(this, value);
  }
}
