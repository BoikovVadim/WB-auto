import { Inject, Injectable, OnModuleInit } from "@nestjs/common";

import { appEnv } from "../common/env";
import type { ExportWbDataDto } from "./dto/export-wb-data.dto";
import { assertSyncPreviewIntegrity } from "./wb-export.integrity";
import { WbProductSearchTextsRangeService } from "./wb-product-search-texts-range.service";
import { WbRuntimeConfigService } from "./wb-runtime-config.service";
import { WbSyncExportHistoryService } from "./wb-sync-export-history.service";
import { WbSyncExportMethodStateService } from "./wb-sync-export-method-state.service";
import { WbSyncExportOrchestratorService } from "./wb-sync-export-orchestrator.service";
import type {
  ExportMethodStatus,
  IntegrationStatusResponse,
  ProductSearchTextsRangeResponse,
  SyncEntity,
  SyncPreviewResponse,
  TokenSessionResponse,
  WbExportJobResponse,
} from "./wb-sync.types";

@Injectable()
export class WbSyncService implements OnModuleInit {
  constructor(
    @Inject(WbRuntimeConfigService)
    private readonly wbRuntimeConfigService: WbRuntimeConfigService,
    @Inject(WbSyncExportMethodStateService)
    private readonly wbSyncExportMethodStateService: WbSyncExportMethodStateService,
    @Inject(WbSyncExportHistoryService)
    private readonly wbSyncExportHistoryService: WbSyncExportHistoryService,
    @Inject(WbSyncExportOrchestratorService)
    private readonly wbSyncExportOrchestratorService: WbSyncExportOrchestratorService,
    @Inject(WbProductSearchTextsRangeService)
    private readonly wbProductSearchTextsRangeService: WbProductSearchTextsRangeService,
  ) {}

  onModuleInit() {
    void this.wbSyncExportHistoryService
      .backfillProductCatalogFromStoredExports()
      .catch(() => undefined);
  }

  getIntegrationStatus(): IntegrationStatusResponse {
    const tokenSource = this.wbRuntimeConfigService.getTokenSource();

    return {
      service: "wb-api",
      connectionStatus: tokenSource === "missing" ? "missing_token" : "ready",
      apiBaseUrl: appEnv.wbApiBaseUrl,
      tokenConfigured: tokenSource !== "missing",
      tokenSource,
      authScheme: "Authorization HeaderApiKey",
      locale: appEnv.wbDefaultLocale,
      dataIntegrity: "valid",
      supportedEntities: this.wbSyncExportMethodStateService.getSupportedEntities(),
      checkedAt: new Date().toISOString(),
    };
  }

  getTokenSession(): TokenSessionResponse {
    const tokenSource = this.wbRuntimeConfigService.getTokenSource();

    return {
      tokenConfigured: tokenSource !== "missing",
      tokenSource,
      updatedAt: new Date().toISOString(),
    };
  }

  async getExportMethods(): Promise<ExportMethodStatus[]> {
    return this.wbSyncExportMethodStateService.getExportMethods(
      await this.wbSyncExportHistoryService.getExportsHistory(),
    );
  }

  async setRuntimeToken(token: string): Promise<TokenSessionResponse> {
    await this.wbRuntimeConfigService.setRuntimeToken(token);
    return this.getTokenSession();
  }

  async clearRuntimeToken(): Promise<TokenSessionResponse> {
    await this.wbRuntimeConfigService.clearRuntimeToken();
    return this.getTokenSession();
  }

  createPreview(entityType: SyncEntity | undefined): SyncPreviewResponse {
    const entity = entityType ?? "search_queries";
    const now = new Date().toISOString();
    const descriptor = this.wbSyncExportMethodStateService.getEntityDescriptor(entity);

    const preview: SyncPreviewResponse = {
      jobId: `preview-${entity}-${Date.now()}`,
      direction: "inbound",
      entityType: entity,
      status: "queued",
      source: "wb-api",
      target: "raw-layer",
      wbApiBaseUrl: appEnv.wbApiBaseUrl,
      dataIntegrity: "valid",
      endpoint: {
        method: descriptor.method,
        path: descriptor.path,
        documentationUrl: descriptor.documentationUrl,
      },
      audit: {
        requestedAt: now,
        requestedBy: "local-bootstrap",
      },
      nextStepCodes: [
        "token_check",
        "raw_fetch",
        "normalize_records",
        "prepare_processing",
      ],
    };

    assertSyncPreviewIntegrity(preview);

    return preview;
  }

  async exportData(dto: ExportWbDataDto): Promise<WbExportJobResponse> {
    return this.wbSyncExportOrchestratorService.exportData(dto);
  }

  async getExportStatus(requestId: string): Promise<WbExportJobResponse> {
    return this.wbSyncExportOrchestratorService.getExportJobStatus(requestId);
  }

  async getExportsHistory() {
    return this.wbSyncExportHistoryService.getExportsHistory();
  }

  async getSavedExport(requestId: string) {
    return this.wbSyncExportHistoryService.getSavedExport(requestId);
  }

  async getProductSearchTextsRange(input: {
    nmId: number;
    startDate: string;
    endDate: string;
  }): Promise<ProductSearchTextsRangeResponse> {
    return this.wbProductSearchTextsRangeService.getProductSearchTextsRange(input);
  }
}
