import { Injectable, NotFoundException } from "@nestjs/common";
import { readdir } from "node:fs/promises";

import { ProductCatalogService } from "../wb-clusters/product-catalog.service";
import {
  ensureWbExportArchiveRoot,
  tryReadStoredWbExport,
} from "./wb-export-archive.store";
import type { WbExportListItem, WbExportResponse } from "./wb-sync.types";

@Injectable()
export class WbSyncExportHistoryService {
  constructor(
    private readonly productCatalogService: ProductCatalogService,
  ) {}

  async getExportsHistory(): Promise<WbExportListItem[]> {
    const archiveRoot = await ensureWbExportArchiveRoot();
    const entries = await readdir(archiveRoot, { withFileTypes: true });
    const history: WbExportListItem[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const savedExport = await tryReadStoredWbExport(entry.name);

      if (savedExport) {
        history.push(this.toExportListItem(savedExport));
      }
    }

    return history.sort((left, right) =>
      right.exportedAt.localeCompare(left.exportedAt),
    );
  }

  async getSavedExport(requestId: string): Promise<WbExportResponse> {
    if (!/^[a-z0-9_-]+$/i.test(requestId)) {
      throw new NotFoundException("Export archive was not found.");
    }

    const savedExport = await tryReadStoredWbExport(requestId);

    if (!savedExport) {
      throw new NotFoundException("Export archive was not found.");
    }

    return savedExport;
  }

  async backfillProductCatalogFromStoredExports() {
    const history = await this.getExportsHistory();
    for (const item of history) {
      if (item.entityType !== "product_search_texts") {
        continue;
      }

      const savedExport = await tryReadStoredWbExport(item.requestId);
      if (!savedExport) {
        continue;
      }

      await this.productCatalogService.upsertProductsFromExport(savedExport);
    }
  }

  toExportListItem(response: WbExportResponse): WbExportListItem {
    return {
      requestId: response.requestId,
      entityType: response.entityType,
      exportedAt: response.exportedAt,
      recordsCount: response.recordsCount,
      productsCount: response.payload.summary.productsCount,
      searchTextsCount: response.payload.summary.searchTextsCount,
      period: response.requestMeta.period ?? response.payload.period,
      rawArchivePath: response.requestMeta.rawArchivePath ?? null,
    };
  }
}
