import { Injectable, Logger } from "@nestjs/common";

import { appEnv } from "../common/env";
import { tryReadStoredWbExport } from "../wb-sync/wb-export-archive.store";
import type { WbExportResponse } from "../wb-sync/wb-sync.types";
import { WbClustersRepository } from "./wb-clusters.repository";
import type { ProductSnapshotWarmupPriority } from "./wb-clusters.types";

type ProductPresetSnapshotJobRecord = {
  jobId: string;
  sourceExportRequestId: string;
  startDate: string;
  endDate: string;
  attemptCount: number;
  nmIds: number[];
};

type ExactPresetSnapshotInput = {
  jobId: string | null;
  exportRequestId: string;
  nmIds: number[];
  explicitPeriod: { start: string; end: string };
  reason: string;
  priority: ProductSnapshotWarmupPriority;
};

type ProductPresetSnapshotRuntime = {
  describeError: (error: unknown) => string;
  markWarmupQueued: (
    nmIds: number[],
    period: { start: string; end: string } | null,
    exportRequestId: string | null,
    priority: ProductSnapshotWarmupPriority,
  ) => void;
  markWarmupRunning: (
    nmIds: number[],
    period: { start: string; end: string },
    exportRequestId: string | null,
  ) => void;
  markWarmupFailed: (
    nmIds: number[],
    period: { start: string; end: string },
    exportRequestId: string | null,
    failureReason: string,
  ) => void;
  clearWarmupState: (
    nmIds: number[],
    period: { start: string; end: string },
    exportRequestId: string | null,
  ) => void;
  runExactMaterializationFromExport: (
    exportRequestId: string,
    nmIds: number[],
    explicitPeriod: { start: string; end: string },
    reason: string,
  ) => Promise<void>;
};

@Injectable()
export class ProductPresetSnapshotOrchestratorService {
  private readonly logger = new Logger(ProductPresetSnapshotOrchestratorService.name);
  private presetSnapshotJobPassPromise: Promise<void> | null = null;
  private readonly directRunsInFlight = new Map<string, Promise<void>>();

  constructor(private readonly wbClustersRepository: WbClustersRepository) {}

  async processJobs(runtime: ProductPresetSnapshotRuntime) {
    if (this.presetSnapshotJobPassPromise) {
      return this.presetSnapshotJobPassPromise;
    }

    const passPromise = (async () => {
      const jobs = await this.wbClustersRepository.claimReadyProductPresetSnapshotJobs(1);
      for (const job of jobs) {
        await this.processJob(job, runtime);
      }
    })().finally(() => {
      this.presetSnapshotJobPassPromise = null;
    });

    this.presetSnapshotJobPassPromise = passPromise;
    return passPromise;
  }

  scheduleExactFromSavedExport(
    input: ExactPresetSnapshotInput,
    runtime: ProductPresetSnapshotRuntime,
  ) {
    const runKey =
      input.jobId ??
      `${input.exportRequestId}:${input.explicitPeriod.start}:${input.explicitPeriod.end}:${input.priority}`;
    if (this.directRunsInFlight.has(runKey)) {
      return;
    }

    const runPromise = (async () => {
      if (input.jobId) {
        const started = await this.wbClustersRepository.startProductPresetSnapshotJob(input.jobId);
        if (!started) {
          return;
        }
      }

      runtime.markWarmupRunning(input.nmIds, input.explicitPeriod, input.exportRequestId);
      try {
        await runtime.runExactMaterializationFromExport(
          input.exportRequestId,
          input.nmIds,
          input.explicitPeriod,
          `${input.reason}:${input.priority}`,
        );
        if (input.jobId) {
          await this.wbClustersRepository.succeedProductPresetSnapshotJob(
            input.jobId,
            input.exportRequestId,
          );
        }
        runtime.clearWarmupState(input.nmIds, input.explicitPeriod, input.exportRequestId);
      } catch (error: unknown) {
        const describedError = runtime.describeError(error);
        if (input.jobId) {
          const retryDelayMs = await this.getPresetSnapshotRetryDelayMs(error);
          if (retryDelayMs !== null) {
            const nextAttemptAt = new Date(Date.now() + retryDelayMs).toISOString();
            await this.wbClustersRepository.rescheduleProductPresetSnapshotJob(input.jobId, {
              nextAttemptAt,
              lastError: `Preset snapshot retry scheduled: ${describedError}`,
            });
            runtime.markWarmupQueued(
              input.nmIds,
              input.explicitPeriod,
              input.exportRequestId,
              "background",
            );
          } else {
            await this.wbClustersRepository.failProductPresetSnapshotJob(input.jobId, describedError);
            runtime.markWarmupFailed(
              input.nmIds,
              input.explicitPeriod,
              input.exportRequestId,
              describedError,
            );
          }
          return;
        }

        runtime.markWarmupFailed(
          input.nmIds,
          input.explicitPeriod,
          input.exportRequestId,
          describedError,
        );
      }
    })().finally(() => {
      this.directRunsInFlight.delete(runKey);
    });

    this.directRunsInFlight.set(runKey, runPromise);
    void runPromise;
  }

  async hasMatchingSavedExport(
    exportRequestId: string,
    explicitPeriod: { start: string; end: string },
  ) {
    const savedExport = await tryReadStoredWbExport(exportRequestId);
    return Boolean(
      savedExport &&
        savedExport.entityType === "product_search_texts" &&
        savedExport.payload.period.currentStart === explicitPeriod.start &&
        savedExport.payload.period.currentEnd === explicitPeriod.end,
    );
  }

  private async processJob(
    job: ProductPresetSnapshotJobRecord,
    runtime: ProductPresetSnapshotRuntime,
  ) {
    const exactPeriod = {
      start: job.startDate,
      end: job.endDate,
    };
    runtime.markWarmupRunning(job.nmIds, exactPeriod, job.sourceExportRequestId);
    try {
      const exported = await this.requestLocalProductSearchTextsExport({
        nmIds: job.nmIds,
        startDate: job.startDate,
        endDate: job.endDate,
      });
      const materializedPeriod = {
        start: exported.payload.period.currentStart,
        end: exported.payload.period.currentEnd,
      };
      await runtime.runExactMaterializationFromExport(
        exported.requestId,
        job.nmIds,
        materializedPeriod,
        `preset-snapshot-job:${job.jobId}`,
      );
      await this.wbClustersRepository.succeedProductPresetSnapshotJob(
        job.jobId,
        exported.requestId,
      );
      runtime.clearWarmupState(job.nmIds, exactPeriod, job.sourceExportRequestId);
    } catch (error: unknown) {
      const retryDelayMs = await this.getPresetSnapshotRetryDelayMs(error);
      if (retryDelayMs !== null) {
        const nextAttemptAt = new Date(Date.now() + retryDelayMs).toISOString();
        await this.wbClustersRepository.rescheduleProductPresetSnapshotJob(job.jobId, {
          nextAttemptAt,
          lastError: `Preset snapshot retry scheduled: ${runtime.describeError(error)}`,
        });
        runtime.markWarmupQueued(
          job.nmIds,
          exactPeriod,
          job.sourceExportRequestId,
          "background",
        );
        return;
      }

      const describedError = runtime.describeError(error);
      await this.wbClustersRepository.failProductPresetSnapshotJob(job.jobId, describedError);
      runtime.markWarmupFailed(
        job.nmIds,
        exactPeriod,
        job.sourceExportRequestId,
        describedError,
      );
    }
  }

  private async requestLocalProductSearchTextsExport(input: {
    nmIds: number[];
    startDate: string;
    endDate: string;
  }): Promise<WbExportResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30 * 60 * 1000);
    try {
      const response = await fetch(
        `http://127.0.0.1:${String(appEnv.port)}/api/wb-sync/exports`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            entityType: "product_search_texts",
            customPayload: {
              nmIds: input.nmIds,
              currentPeriod: {
                start: input.startDate,
                end: input.endDate,
              },
            },
          }),
          signal: controller.signal,
        },
      );
      const rawText = await response.text();
      const parsed = rawText ? (JSON.parse(rawText) as unknown) : null;
      if (!response.ok) {
        const error = new Error(
          `Local product_search_texts export failed with status ${response.status}.`,
        ) as Error & { statusCode?: number; responseBody?: unknown };
        error.statusCode = response.status;
        error.responseBody = parsed;
        throw error;
      }
      return parsed as WbExportResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getPresetSnapshotRetryDelayMs(error: unknown) {
    const statusCode =
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : null;
    if (statusCode !== 429) {
      return null;
    }

    try {
      const response = await fetch(`http://127.0.0.1:${String(appEnv.port)}/api/wb-sync/methods`);
      const methods = (await response.json()) as Array<{
        entityType?: string;
        cooldown?: { waitSeconds?: number };
      }>;
      const productSearchTextsMethod = methods.find(
        (method) => method.entityType === "product_search_texts",
      );
      const waitSeconds = productSearchTextsMethod?.cooldown?.waitSeconds;
      if (typeof waitSeconds === "number" && Number.isFinite(waitSeconds) && waitSeconds > 0) {
        return waitSeconds * 1000 + 5_000;
      }
    } catch (error) {
      this.logger.warn(
        `Unable to read product_search_texts cooldown from wb-sync methods endpoint: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    return 61 * 60 * 1000;
  }
}
