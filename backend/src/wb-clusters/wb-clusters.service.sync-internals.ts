import type { SellerAnalyticsReportCandidate } from "./monthly-frequency-analytics.ingest";
import type { SyncPhaseResult } from "./wb-clusters-sync-orchestrator.service";
import type {
  ClusterSyncPhase,
  PromotionCampaignDetailsItem,
} from "./wb-clusters.types";
import * as wb_clusters_sync_flow from "./wb-clusters-sync-flow";
import type { WbClustersStatsSyncContext } from "./wb-clusters.flow-context";
import { WbClustersServiceCommandInternals } from "./wb-clusters.service.command-internals";

export abstract class WbClustersServiceSyncInternals extends WbClustersServiceCommandInternals {
  protected async getCampaignCountsWithQuickRetry(
    label: string,
    warningMessages: string[],
  ) {
    return wb_clusters_sync_flow.getCampaignCountsWithQuickRetry(this, label, warningMessages);
  }

  protected async getCampaignDetailsWithQuickRetry(
    advertIds: number[],
    label: string,
    warningMessages: string[],
  ) {
    return wb_clusters_sync_flow.getCampaignDetailsWithQuickRetry(
      this,
      advertIds,
      label,
      warningMessages,
    );
  }

  protected async tryPromotionStepWithQuickRetry<T>(
    label: string,
    action: () => Promise<T>,
    warningMessages: string[],
  ): Promise<T | null> {
    return wb_clusters_sync_flow.tryPromotionStepWithQuickRetry(
      this,
      label,
      action,
      warningMessages,
    );
  }

  protected async syncMonthlyFrequencyReadModel(input: {
    syncRunId: string;
    nmId: number | null;
    warningMessages: string[];
  }) {
    return wb_clusters_sync_flow.syncMonthlyFrequencyReadModel(this, input);
  }

  protected async trySyncMonthlyFrequencyCandidate(input: {
    syncRunId: string;
    nmId: number | null;
    period: { from: string; to: string; timezone: string };
    candidate: SellerAnalyticsReportCandidate;
    warningMessages: string[];
  }): Promise<"done" | "continue"> {
    return wb_clusters_sync_flow.trySyncMonthlyFrequencyCandidate(this, input);
  }

  protected async downloadMonthlyFrequencyReport(input: {
    syncRunId: string;
    nmId: number | null;
    reportId: string;
    candidate: SellerAnalyticsReportCandidate;
    period: { from: string; to: string; timezone: string };
    warningMessages: string[];
  }) {
    return wb_clusters_sync_flow.downloadMonthlyFrequencyReport(this, input);
  }

  protected async syncFreePortalMonthlyFrequencyReport(input: {
    syncRunId: string;
    nmId: number | null;
    period: { from: string; to: string; timezone: string };
    warningMessages: string[];
  }) {
    return wb_clusters_sync_flow.syncFreePortalMonthlyFrequencyReport(this, input);
  }

  protected async getSellerAnalyticsReportList() {
    return wb_clusters_sync_flow.getSellerAnalyticsReportList(this);
  }

  protected async createSellerAnalyticsReport(input: {
    reportId: string;
    candidate: SellerAnalyticsReportCandidate;
  }) {
    return wb_clusters_sync_flow.createSellerAnalyticsReport(this, input);
  }

  protected async retrySellerAnalyticsReport(reportId: string) {
    return wb_clusters_sync_flow.retrySellerAnalyticsReport(this, reportId);
  }

  protected async getSellerAnalyticsReportFile(reportId: string) {
    return wb_clusters_sync_flow.getSellerAnalyticsReportFile(this, reportId);
  }

  protected getMonthlyFrequencyPeriod() {
    return wb_clusters_sync_flow.getMonthlyFrequencyPeriod(this);
  }

  protected async tryAnalyticsStep<T>(
    label: string,
    action: () => Promise<T>,
    warningMessages: string[],
  ): Promise<T | null> {
    return wb_clusters_sync_flow.tryAnalyticsStep(this, label, action, warningMessages);
  }

  protected parseWordsClustersWorkbook(workbookBuffer: Buffer) {
    return wb_clusters_sync_flow.parseWordsClustersWorkbook(this, workbookBuffer);
  }

  protected async syncCabinetClusterQueries(input: {
    syncRunId: string;
    advertId: number;
    nmId: number;
    warningMessages: string[];
    archiveBuffer?: {
      push: (entry: {
        archiveType: string;
        advertId: number | null;
        nmId: number | null;
        payload: unknown;
      }) => void;
    };
  }) {
    return wb_clusters_sync_flow.syncCabinetClusterQueries(this, input);
  }

  protected async syncCmpClusterQueries(input: {
    syncRunId: string;
    advertId: number;
    nmId: number;
    warningMessages: string[];
    archiveBuffer?: {
      push: (entry: {
        archiveType: string;
        advertId: number | null;
        nmId: number | null;
        payload: unknown;
      }) => void;
    };
  }) {
    return wb_clusters_sync_flow.syncCmpClusterQueries(this, input);
  }

  protected async isCabinetSessionReady() {
    return wb_clusters_sync_flow.isCabinetSessionReady(this);
  }

  protected async runJamSyncForNmIds(
    nmIds: number[],
    warningMessages: string[],
    options?: { todayOnly?: boolean },
  ) {
    return wb_clusters_sync_flow.runJamSyncPhase(this, nmIds, warningMessages, options);
  }

  protected async finalizeJamYesterday(nmIds: number[], warningMessages: string[]) {
    return wb_clusters_sync_flow.runJamFinalizeYesterday(this, nmIds, warningMessages);
  }

  /**
   * Starts the continuous JAM today-loop in the background.
   * Returns a promise that resolves only when the loop is stopped via
   * jamTodayLoopSignal.stopped = true (i.e. never during normal operation).
   * Call once from onModuleInit; do not await — fire-and-forget.
   */
  startJamTodayLoop(): Promise<void> {
    return wb_clusters_sync_flow.runJamTodayLoop(this, this.jamTodayLoopSignal);
  }

  /**
   * Starts the one-time JAM backfill loop in the background.
   * Fills all 30 historical days per product (active-RK A→Z first, then all
   * others A→Z) before moving to the next product.  Stops automatically when
   * two consecutive passes find nothing left to sync.
   * Call once from onModuleInit; do not await — fire-and-forget.
   */
  startJamBackfillLoop(): Promise<void> {
    return wb_clusters_sync_flow.runJamBackfillLoop(this, this.jamBackfillLoopSignal);
  }

  protected async runInventorySyncPhase(syncRunId: string): Promise<SyncPhaseResult> {
    return wb_clusters_sync_flow.runInventorySyncPhase(this, syncRunId);
  }

  protected async runStructureSyncPhase(syncRunId: string): Promise<SyncPhaseResult> {
    return wb_clusters_sync_flow.runStructureSyncPhase(this, syncRunId);
  }

  protected async runStatsSyncPhase(syncRunId: string): Promise<SyncPhaseResult> {
    return wb_clusters_sync_flow.runStatsSyncPhase(
      this as unknown as WbClustersStatsSyncContext,
      syncRunId,
    );
  }

  protected async runStatsBackfillPhase(syncRunId: string): Promise<SyncPhaseResult> {
    return wb_clusters_sync_flow.runStatsSyncPhase(
      this as unknown as WbClustersStatsSyncContext,
      syncRunId,
      { overridePeriod: this.getStatsBackfillPeriod() },
    );
  }

  protected async updatePhaseCursorState(
    phase: ClusterSyncPhase,
    advertId: number,
    syncRunId: string,
    updateGlobal: boolean,
  ) {
    return wb_clusters_sync_flow.updatePhaseCursorState(
      this,
      phase,
      advertId,
      syncRunId,
      updateGlobal,
    );
  }

  protected maxDefinedNumber(...values: Array<number | null>) {
    return wb_clusters_sync_flow.maxDefinedNumber(this, ...values);
  }

  protected getStatsPeriod() {
    return wb_clusters_sync_flow.getStatsPeriod(this);
  }

  protected getStatsBackfillPeriod() {
    return wb_clusters_sync_flow.getStatsBackfillPeriod(this);
  }

  protected toIsoDate(date: Date) {
    return wb_clusters_sync_flow.toIsoDate(this, date);
  }

  protected chunkArray<T>(items: T[], chunkSize: number) {
    return wb_clusters_sync_flow.chunkArray(this, items, chunkSize);
  }

  protected extractProductsFromDetail(detail: PromotionCampaignDetailsItem) {
    return wb_clusters_sync_flow.extractProductsFromDetail(this, detail);
  }

  protected async tryApiStep<T>(
    label: string,
    action: () => Promise<T>,
    warningMessages: string[],
  ): Promise<T | null> {
    return wb_clusters_sync_flow.tryApiStep(this, label, action, warningMessages);
  }

  protected async tryCmpStep<T>(
    label: string,
    action: () => Promise<T>,
    warningMessages: string[],
  ): Promise<T | null> {
    return wb_clusters_sync_flow.tryCmpStep(this, label, action, warningMessages);
  }

  protected isRecoverablePromotionError(error: unknown) {
    return wb_clusters_sync_flow.isRecoverablePromotionError(this, error);
  }

  protected describeError(error: unknown) {
    return wb_clusters_sync_flow.describeError(this, error);
  }

  protected pushWarning(warningMessages: string[], message: string) {
    return wb_clusters_sync_flow.pushWarning(this, warningMessages, message);
  }

  protected summarizeWarnings(warningMessages: string[]) {
    return wb_clusters_sync_flow.summarizeWarnings(this, warningMessages);
  }

  protected activateManualBidInteractiveWindow(reason: string, durationMs: number) {
    return wb_clusters_sync_flow.activateManualBidInteractiveWindow(
      this,
      reason,
      durationMs,
    );
  }

  protected isManualBidInteractiveWindowActive() {
    return wb_clusters_sync_flow.isManualBidInteractiveWindowActive(this);
  }

  protected getManualBidInteractiveRemainingMs() {
    return wb_clusters_sync_flow.getManualBidInteractiveRemainingMs(this);
  }
}
