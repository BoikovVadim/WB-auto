import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ensureWbExportArchiveMetaRoot,
  writeWbExportJsonFile,
} from "./wb-export-archive.store";
import type {
  ExportMethodStatus,
  SyncEntity,
  SyncEntityDescriptor,
  WbExportListItem,
} from "./wb-sync.types";

interface StoredExportMethodState {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastRequestId: string | null;
  lastErrorMessage: string | null;
  cooldownStartedAt: string | null;
}

@Injectable()
export class WbSyncExportMethodStateService {
  private readonly exportCooldownSecondsByEntity: Record<SyncEntity, number> = {
    search_queries: 60 * 60,
    product_search_texts: 60 * 60,
  };

  private readonly supportedEntities: SyncEntityDescriptor[] = [
    {
      code: "search_queries",
      method: "POST",
      path: "/api/v2/search-report/report",
      documentationUrl: "https://dev.wildberries.ru/docs/openapi/analytics",
      tokenCategory: "Analytics",
    },
    {
      code: "product_search_texts",
      method: "POST",
      path: "/api/v2/search-report/product/search-texts",
      documentationUrl: "https://dev.wildberries.ru/docs/openapi/analytics",
      tokenCategory: "Analytics",
    },
  ];

  getSupportedEntities() {
    return this.supportedEntities;
  }

  getEntityDescriptor(entityType: SyncEntity): SyncEntityDescriptor {
    const descriptor = this.supportedEntities.find((item) => item.code === entityType);

    if (!descriptor) {
      throw new Error(`Unsupported WB export entity: ${entityType}`);
    }

    return descriptor;
  }

  async getExportMethods(history: WbExportListItem[]): Promise<ExportMethodStatus[]> {
    const storedState = await this.readStoredExportMethodState();

    return this.supportedEntities.map((descriptor) =>
      this.toExportMethodStatus(
        descriptor.code,
        storedState[descriptor.code] ?? this.createEmptyMethodState(),
        history.find((item) => item.entityType === descriptor.code) ?? null,
      ),
    );
  }

  async assertMethodReady(entityType: SyncEntity) {
    const storedState = await this.readStoredExportMethodState();
    const methodStatus = this.toExportMethodStatus(
      entityType,
      storedState[entityType] ?? this.createEmptyMethodState(),
      null,
    );

    if (methodStatus.cooldown.isActive) {
      throw new HttpException(
        `Для этой выгрузки действует таймер ожидания. Следующий безопасный запуск будет доступен через ${this.formatWaitSeconds(methodStatus.cooldown.waitSeconds)}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async markMethodAttempt(entityType: SyncEntity) {
    await this.updateStoredExportMethodState(entityType, {
      lastAttemptAt: new Date().toISOString(),
      cooldownStartedAt: new Date().toISOString(),
      lastErrorMessage: null,
    });
  }

  async markMethodSuccess(entityType: SyncEntity, requestId: string) {
    await this.updateStoredExportMethodState(entityType, {
      lastSuccessAt: new Date().toISOString(),
      lastRequestId: requestId,
      lastErrorMessage: null,
    });
  }

  async markMethodFailure(entityType: SyncEntity, error: unknown) {
    await this.updateStoredExportMethodState(entityType, {
      lastErrorMessage: this.getErrorMessage(error),
    });
  }

  private toExportMethodStatus(
    entityType: SyncEntity,
    storedState: StoredExportMethodState,
    latestExport: WbExportListItem | null,
  ): ExportMethodStatus {
    const descriptor = this.getEntityDescriptor(entityType);
    const cooldownSeconds = this.exportCooldownSecondsByEntity[entityType];
    const nowMs = Date.now();
    const nextAvailableAt = storedState.cooldownStartedAt
      ? new Date(
          new Date(storedState.cooldownStartedAt).getTime() + cooldownSeconds * 1000,
        ).toISOString()
      : null;
    const waitSeconds = nextAvailableAt
      ? Math.max(
          0,
          Math.ceil((new Date(nextAvailableAt).getTime() - nowMs) / 1000),
        )
      : 0;

    return {
      entityType,
      title: this.getMethodTitle(entityType),
      description: this.getMethodDescription(entityType),
      documentationUrl: descriptor.documentationUrl,
      tokenCategory: descriptor.tokenCategory,
      apiPath: descriptor.path,
      cooldown: {
        cooldownSeconds,
        startedAt: storedState.cooldownStartedAt,
        nextAvailableAt,
        waitSeconds,
        isActive: waitSeconds > 0,
      },
      lastAttemptAt: storedState.lastAttemptAt,
      lastSuccessAt: storedState.lastSuccessAt,
      lastRequestId: storedState.lastRequestId,
      lastErrorMessage: storedState.lastErrorMessage,
      latestExportId: latestExport?.requestId ?? storedState.lastRequestId,
    };
  }

  private getMethodTitle(entityType: SyncEntity) {
    switch (entityType) {
      case "search_queries":
        return "Сводная аналитика по запросам";
      case "product_search_texts":
        return "Топ поисковых фраз по артикулам";
    }
  }

  private getMethodDescription(entityType: SyncEntity) {
    switch (entityType) {
      case "search_queries":
        return "Недельная сводка по товарам с метриками карточки и поисковыми фразами.";
      case "product_search_texts":
        return "Отдельная выгрузка top поисковых фраз. WB отдает до 30 запросов на 1 артикул.";
    }
  }

  private async updateStoredExportMethodState(
    entityType: SyncEntity,
    patch: Partial<StoredExportMethodState>,
  ) {
    const currentState = await this.readStoredExportMethodState();
    const nextState = {
      ...currentState,
      [entityType]: {
        ...(currentState[entityType] ?? this.createEmptyMethodState()),
        ...patch,
      },
    };

    await writeWbExportJsonFile(
      await ensureWbExportArchiveMetaRoot(),
      "export-method-state.json",
      nextState,
    );
  }

  private async readStoredExportMethodState() {
    try {
      const rawValue = await readFile(
        path.join(
          await ensureWbExportArchiveMetaRoot(),
          "export-method-state.json",
        ),
        "utf-8",
      );
      const parsed = JSON.parse(rawValue) as Partial<
        Record<SyncEntity, StoredExportMethodState>
      >;

      return {
        search_queries: {
          ...this.createEmptyMethodState(),
          ...(parsed.search_queries ?? {}),
        },
        product_search_texts: {
          ...this.createEmptyMethodState(),
          ...(parsed.product_search_texts ?? {}),
        },
      } satisfies Record<SyncEntity, StoredExportMethodState>;
    } catch {
      return {
        search_queries: this.createEmptyMethodState(),
        product_search_texts: this.createEmptyMethodState(),
      } satisfies Record<SyncEntity, StoredExportMethodState>;
    }
  }

  private createEmptyMethodState(): StoredExportMethodState {
    return {
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastRequestId: null,
      lastErrorMessage: null,
      cooldownStartedAt: null,
    };
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return null;
  }

  private formatWaitSeconds(value: number) {
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = value % 60;
    const parts = [];

    if (hours > 0) {
      parts.push(`${hours} ч`);
    }

    if (minutes > 0) {
      parts.push(`${minutes} мин`);
    }

    if (seconds > 0 || parts.length === 0) {
      parts.push(`${seconds} сек`);
    }

    return parts.join(" ");
  }
}
