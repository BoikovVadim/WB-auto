import { Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { readdir } from "node:fs/promises";

import { appEnv } from "../common/env";
import { ProductCatalogService } from "../wb-clusters/product-catalog.service";
import type { ExportWbDataDto } from "./dto/export-wb-data.dto";
import {
  createWbExportRawArchiveDirectory,
  ensureWbExportArchiveRoot,
  tryReadStoredWbExport,
  tryReadStoredWbExportJobStatus,
  writeWbExportJobStatus,
  writeWbExportJsonFile,
} from "./wb-export-archive.store";
import { assertWbExportIntegrity, assertWbExportJobIntegrity } from "./wb-export.integrity";
import { resolveSearchQueriesPeriod } from "./wb-search-queries-period";
import { WbSearchQueriesExportService } from "./wb-search-queries-export.service";
import { hasOwnKeys } from "./wb-search-queries-request-options";
import { WbSyncExportHistoryService } from "./wb-sync-export-history.service";
import { WbSyncExportMethodStateService } from "./wb-sync-export-method-state.service";
import type { SyncEntityDescriptor, WbExportJobResponse, WbExportResponse } from "./wb-sync.types";

@Injectable()
export class WbSyncExportOrchestratorService implements OnModuleInit {
  private readonly inFlightExports = new Map<string, Promise<void>>();

  constructor(
    private readonly productCatalogService: ProductCatalogService,
    private readonly wbSearchQueriesExportService: WbSearchQueriesExportService,
    private readonly wbSyncExportHistoryService: WbSyncExportHistoryService,
    private readonly wbSyncExportMethodStateService: WbSyncExportMethodStateService,
  ) {}

  async onModuleInit() {
    await this.failStaleQueuedExports();
  }

  async exportData(dto: ExportWbDataDto): Promise<WbExportJobResponse> {
    await this.wbSyncExportMethodStateService.assertMethodReady(dto.entityType);

    const descriptor =
      this.wbSyncExportMethodStateService.getEntityDescriptor(dto.entityType);
    const locale = dto.locale?.trim() || appEnv.wbDefaultLocale;
    const period = resolveSearchQueriesPeriod(dto.customPayload);
    const requestId = `export-${dto.entityType}-${Date.now()}`;
    const requestedAt = new Date().toISOString();
    await this.wbSyncExportMethodStateService.markMethodAttempt(dto.entityType);
    await createWbExportRawArchiveDirectory(requestId);

    const queuedJob = this.buildJobResponse({
      requestId,
      descriptor,
      entityType: dto.entityType,
      requestMeta: {
        locale,
        customPayloadApplied: hasOwnKeys(dto.customPayload),
        period,
      },
      requestedAt,
      status: "queued",
      startedAt: null,
      finishedAt: null,
      recordsCount: null,
      resultAvailable: false,
      errorMessage: null,
    });
    await writeWbExportJobStatus(requestId, queuedJob);

    const exportPromise = this.runExportInBackground({
      dto,
      requestId,
      requestedAt,
      descriptor,
      locale,
      period,
    }).finally(() => {
      this.inFlightExports.delete(requestId);
    });
    this.inFlightExports.set(requestId, exportPromise);
    void exportPromise;

    return queuedJob;
  }

  async getExportJobStatus(requestId: string): Promise<WbExportJobResponse> {
    if (!/^[a-z0-9_-]+$/i.test(requestId)) {
      throw new NotFoundException("Export job was not found.");
    }

    const savedStatus = await tryReadStoredWbExportJobStatus(requestId);
    if (savedStatus) {
      if (
        (savedStatus.status === "queued" || savedStatus.status === "running") &&
        !this.inFlightExports.has(requestId)
      ) {
        const failedStatus = {
          ...savedStatus,
          status: "failed" as const,
          finishedAt: savedStatus.finishedAt ?? new Date().toISOString(),
          resultAvailable: false,
          errorMessage:
            savedStatus.errorMessage ??
            "Export job was interrupted before completion. Please run it again.",
        };
        await writeWbExportJobStatus(requestId, failedStatus);
        return failedStatus;
      }

      return savedStatus;
    }

    const savedExport = await tryReadStoredWbExport(requestId);
    if (savedExport) {
      const succeededStatus = this.buildSucceededJobFromExport(savedExport);
      await writeWbExportJobStatus(requestId, succeededStatus);
      return succeededStatus;
    }

    throw new NotFoundException("Export job was not found.");
  }

  private async runExportInBackground(input: {
    dto: ExportWbDataDto;
    requestId: string;
    requestedAt: string;
    descriptor: SyncEntityDescriptor;
    locale: string;
    period: ReturnType<typeof resolveSearchQueriesPeriod>;
  }) {
    const runningStatus = this.buildJobResponse({
      requestId: input.requestId,
      descriptor: input.descriptor,
      entityType: input.dto.entityType,
      requestMeta: {
        locale: input.locale,
        customPayloadApplied: hasOwnKeys(input.dto.customPayload),
        period: input.period,
      },
      requestedAt: input.requestedAt,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      recordsCount: null,
      resultAvailable: false,
      errorMessage: null,
    });
    await writeWbExportJobStatus(input.requestId, runningStatus);

    try {
      const rawArchivePath = await createWbExportRawArchiveDirectory(input.requestId);
      const payload =
        input.dto.entityType === "product_search_texts"
          ? await this.wbSearchQueriesExportService.exportProductSearchTexts(
              input.period,
              input.dto.customPayload,
              rawArchivePath,
            )
          : await this.wbSearchQueriesExportService.exportSearchQueries(
              input.period,
              input.dto.customPayload,
              rawArchivePath,
            );
      const exportedAt = new Date().toISOString();

      const response: WbExportResponse = {
        requestId: input.requestId,
        exportStatus: "succeeded",
        entityType: input.dto.entityType,
        exportedAt,
        dataIntegrity: "valid",
        endpoint: {
          method: input.descriptor.method,
          path: input.descriptor.path,
          documentationUrl: input.descriptor.documentationUrl,
        },
        recordsCount: payload.products.length,
        requestMeta: {
          locale: input.locale,
          customPayloadApplied: hasOwnKeys(input.dto.customPayload),
          period: input.period,
          rawArchivePath,
        },
        payload,
      };

      assertWbExportIntegrity(response);
      await writeWbExportJsonFile(rawArchivePath, "result.json", response);
      await writeWbExportJsonFile(
        rawArchivePath,
        "meta.json",
        this.wbSyncExportHistoryService.toExportListItem(response),
      );
      await this.productCatalogService.upsertProductsFromExport(response);
      await this.wbSyncExportMethodStateService.markMethodSuccess(
        input.dto.entityType,
        input.requestId,
      );
      await writeWbExportJobStatus(
        input.requestId,
        this.buildSucceededJobFromExport(response, input.requestedAt, runningStatus.startedAt),
      );
    } catch (error) {
      await this.wbSyncExportMethodStateService.markMethodFailure(
        input.dto.entityType,
        error,
      );
      await writeWbExportJobStatus(
        input.requestId,
        this.buildJobResponse({
          requestId: input.requestId,
          descriptor: input.descriptor,
          entityType: input.dto.entityType,
          requestMeta: {
            locale: input.locale,
            customPayloadApplied: hasOwnKeys(input.dto.customPayload),
            period: input.period,
          },
          requestedAt: input.requestedAt,
          status: "failed",
          startedAt: runningStatus.startedAt,
          finishedAt: new Date().toISOString(),
          recordsCount: null,
          resultAvailable: false,
          errorMessage: this.getErrorMessage(error),
        }),
      );
    }
  }

  private buildSucceededJobFromExport(
    response: WbExportResponse,
    requestedAt = response.exportedAt,
    startedAt: string | null = response.exportedAt,
  ): WbExportJobResponse {
    return this.buildJobResponse({
      requestId: response.requestId,
      descriptor: response.endpoint,
      entityType: response.entityType,
      requestMeta: {
        locale: response.requestMeta.locale,
        customPayloadApplied: response.requestMeta.customPayloadApplied,
        period: response.requestMeta.period,
      },
      requestedAt,
      status: "succeeded",
      startedAt,
      finishedAt: response.exportedAt,
      recordsCount: response.recordsCount,
      resultAvailable: true,
      errorMessage: null,
    });
  }

  private buildJobResponse(input: {
    requestId: string;
    descriptor: Pick<WbExportJobResponse["endpoint"], "method" | "path" | "documentationUrl">;
    entityType: WbExportJobResponse["entityType"];
    requestMeta: WbExportJobResponse["requestMeta"];
    requestedAt: string;
    status: WbExportJobResponse["status"];
    startedAt: string | null;
    finishedAt: string | null;
    recordsCount: number | null;
    resultAvailable: boolean;
    errorMessage: string | null;
  }): WbExportJobResponse {
    const response: WbExportJobResponse = {
      requestId: input.requestId,
      entityType: input.entityType,
      status: input.status,
      requestedAt: input.requestedAt,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      dataIntegrity: "valid",
      endpoint: {
        method: input.descriptor.method,
        path: input.descriptor.path,
        documentationUrl: input.descriptor.documentationUrl,
      },
      requestMeta: input.requestMeta,
      recordsCount: input.recordsCount,
      resultAvailable: input.resultAvailable,
      errorMessage: input.errorMessage,
    };
    assertWbExportJobIntegrity(response);
    return response;
  }

  private async failStaleQueuedExports() {
    const archiveRoot = await ensureWbExportArchiveRoot();
    const entries = await readdir(archiveRoot, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const savedStatus = await tryReadStoredWbExportJobStatus(entry.name);
      if (!savedStatus) {
        continue;
      }

      if (savedStatus.status !== "queued" && savedStatus.status !== "running") {
        continue;
      }

      await writeWbExportJobStatus(entry.name, {
        ...savedStatus,
        status: "failed",
        finishedAt: new Date().toISOString(),
        resultAvailable: false,
        errorMessage:
          savedStatus.errorMessage ??
          "Export job was interrupted during a previous process lifecycle.",
      });
    }
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return "Unknown WB export error.";
  }
}
