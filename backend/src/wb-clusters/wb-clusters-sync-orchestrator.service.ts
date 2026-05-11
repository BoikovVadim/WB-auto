import { Injectable, Logger } from "@nestjs/common";

import { appEnv } from "../common/env";
import { WbClustersRepository } from "./wb-clusters.repository";
import type {
  ClusterSyncMode,
  ClusterSyncPhase,
  ClusterSyncTrigger,
  WbClustersSyncRunSummary,
} from "./wb-clusters.types";

export type SyncPhaseResult = {
  campaignsSeen: number;
  campaignsSynced: number;
  productsSeen: number;
  clustersUpserted: number;
  statsRowsUpserted: number;
  warningMessages: string[];
  nmIdsSeen: number[];
};

type SyncOrchestratorRuntime = {
  syncMonthlyFrequencyReadModel: (input: {
    syncRunId: string;
    nmId: number | null;
    warningMessages: string[];
  }) => Promise<void>;
  runInventorySyncPhase: (syncRunId: string) => Promise<SyncPhaseResult>;
  runStructureSyncPhase: (syncRunId: string) => Promise<SyncPhaseResult>;
  runStatsSyncPhase: (syncRunId: string) => Promise<SyncPhaseResult>;
  recordPhaseTelemetry: (
    phase: ClusterSyncPhase,
    campaignsSynced: number,
    elapsedMs: number,
  ) => void;
  runJamSyncForNmIds: (nmIds: number[], warningMessages: string[]) => Promise<void>;
  materializeProductAdvertisingSheets: (nmIds: number[], reason: string) => Promise<void>;
  /** Fire-and-forget: re-materialize only the week+today period for nmIds right
   *  after stats sync, so reads are instant before the full materialization pass. */
  scheduleWeekPeriodMaterialization: (nmIds: number[]) => void;
  summarizeWarnings: (warningMessages: string[]) => string | null;
};

@Injectable()
export class WbClustersSyncOrchestratorService {
  private readonly logger = new Logger(WbClustersSyncOrchestratorService.name);

  constructor(private readonly wbClustersRepository: WbClustersRepository) {}

  async runSyncInternal(
    trigger: ClusterSyncTrigger,
    syncRunId: string,
    mode: ClusterSyncMode,
    runtime: SyncOrchestratorRuntime,
  ): Promise<WbClustersSyncRunSummary> {
    let campaignsSeen = 0;
    let campaignsSynced = 0;
    let productsSeen = 0;
    let clustersUpserted = 0;
    let statsRowsUpserted = 0;
    const warningMessages: string[] = [];
    const warmupNmIds = new Set<number>();

    try {
      await this.wbClustersRepository.backfillMissingCampaignProductSearchBidsFromArchives();

      if (mode === "full" && appEnv.wbPromotionEnableMonthlyFrequencyInFullSync) {
        try {
          await runtime.syncMonthlyFrequencyReadModel({
            syncRunId,
            nmId: null,
            warningMessages,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown monthly frequency sync error";
          this.logger.warn(
            `Monthly frequency sync failed during ${trigger} ${mode} cluster sync; continuing with product advertising materialization. ${message}`,
          );
          warningMessages.push(
            `Monthly frequency sync failed but product advertising sync continued: ${message}`,
          );
        }
      }

      const phases: ClusterSyncPhase[] =
        mode === "full" ? ["inventory", "structure", "stats"] : [mode];

      for (const phase of phases) {
        const phaseStartedAtMs = Date.now();
        const phaseResult =
          phase === "inventory"
            ? await runtime.runInventorySyncPhase(syncRunId)
            : phase === "structure"
              ? await runtime.runStructureSyncPhase(syncRunId)
              : await runtime.runStatsSyncPhase(syncRunId);

        campaignsSeen = Math.max(campaignsSeen, phaseResult.campaignsSeen);
        campaignsSynced += phaseResult.campaignsSynced;
        productsSeen += phaseResult.productsSeen;
        clustersUpserted += phaseResult.clustersUpserted;
        statsRowsUpserted += phaseResult.statsRowsUpserted;
        warningMessages.push(...phaseResult.warningMessages);
        for (const nmId of phaseResult.nmIdsSeen) {
          warmupNmIds.add(nmId);
        }

        runtime.recordPhaseTelemetry(
          phase,
          phaseResult.campaignsSynced,
          Date.now() - phaseStartedAtMs,
        );

        // After stats are persisted to DB, immediately trigger background
        // re-materialization of the week+today periods with high concurrency so
        // that a user who opens a product right after this sync sees data
        // instantly — without waiting for the full end-of-sync materialization pass.
        if (phase === "stats" && phaseResult.nmIdsSeen.length > 0) {
          runtime.scheduleWeekPeriodMaterialization(phaseResult.nmIdsSeen);
        }

        await this.wbClustersRepository.updateSyncRunProgress(syncRunId, {
          campaignsSeen,
          campaignsSynced,
          productsSeen,
          clustersUpserted,
          statsRowsUpserted,
          warningCount: warningMessages.length,
          hasPartialFailure: warningMessages.length > 0,
          errorMessage: runtime.summarizeWarnings(warningMessages),
        });
      }

      if (mode === "full" && appEnv.wbPromotionEnableJamInFullSync && warmupNmIds.size > 0) {
        try {
          await runtime.runJamSyncForNmIds(Array.from(warmupNmIds), warningMessages);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown Jam sync error";
          this.logger.warn(
            `Jam sync failed during ${trigger} ${mode} cluster sync; continuing with materialization. ${message}`,
          );
          warningMessages.push(`Jam sync failed but product advertising sync continued: ${message}`);
        }
      }

      if (warmupNmIds.size > 0) {
        await runtime.materializeProductAdvertisingSheets(
          Array.from(warmupNmIds),
          trigger === "schedule" ? "scheduled-sync" : `${trigger}-${mode}-sync`,
        );
      }

      const warningSummary = runtime.summarizeWarnings(warningMessages);

      await this.wbClustersRepository.completeSyncRun(syncRunId, {
        status: "succeeded",
        campaignsSeen,
        campaignsSynced,
        productsSeen,
        clustersUpserted,
        statsRowsUpserted,
        warningCount: warningMessages.length,
        hasPartialFailure: warningMessages.length > 0,
        errorMessage: warningSummary,
      });

      return {
        syncRunId,
        status: "succeeded",
        trigger,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        campaignsSeen,
        campaignsSynced,
        productsSeen,
        clustersUpserted,
        statsRowsUpserted,
        warningCount: warningMessages.length,
        hasPartialFailure: warningMessages.length > 0,
        errorMessage: warningSummary,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown WB cluster sync error";
      await this.wbClustersRepository.completeSyncRun(syncRunId, {
        status: "failed",
        campaignsSeen,
        campaignsSynced,
        productsSeen,
        clustersUpserted,
        statsRowsUpserted,
        warningCount: warningMessages.length,
        hasPartialFailure: warningMessages.length > 0,
        errorMessage,
      });
      throw error;
    }
  }
}
