import { Inject, Injectable, Logger } from "@nestjs/common";

import type { WbExportResponse } from "../wb-sync/wb-sync.types";
import { WbRuntimeConfigService } from "../wb-sync/wb-runtime-config.service";
import { WbClustersRepository } from "./wb-clusters.repository";
import type { ProductCatalogResponse } from "./wb-clusters.types";

const WB_CONTENT_API_CARDS_URL =
  "https://content-api.wildberries.ru/content/v2/get/cards/list";

interface WbContentCardRaw {
  nmID?: number;
  vendorCode?: string;
  title?: string;
  brand?: string;
  subjectName?: string;
}

type ContentApiResponse = {
  cards?: WbContentCardRaw[];
  cursor?: { updatedAt?: string; nmID?: number; total?: number };
};

@Injectable()
export class ProductCatalogService {
  private readonly logger = new Logger(ProductCatalogService.name);
  private contentSyncRunning = false;

  // In-memory cache: avoids a DB round-trip on every catalog request.
  // TTL 5 min — fresh enough that campaign/catalog edits propagate quickly.
  private catalogCache: { response: ProductCatalogResponse; expiresAtMs: number } | null = null;
  private readonly catalogCacheTtlMs = 5 * 60_000;

  constructor(
    @Inject(WbClustersRepository)
    private readonly wbClustersRepository: WbClustersRepository,
    @Inject(WbRuntimeConfigService)
    private readonly wbRuntimeConfigService: WbRuntimeConfigService,
  ) {}

  async getProductCatalog(): Promise<ProductCatalogResponse> {
    if (this.catalogCache && Date.now() < this.catalogCache.expiresAtMs) {
      return this.catalogCache.response;
    }
    const response: ProductCatalogResponse = {
      checkedAt: new Date().toISOString(),
      items: await this.wbClustersRepository.listProductCatalogItems(),
    };
    this.catalogCache = { response, expiresAtMs: Date.now() + this.catalogCacheTtlMs };
    return response;
  }

  invalidateCatalogCache() {
    this.catalogCache = null;
  }

  async upsertProductsFromExport(exportResponse: WbExportResponse) {
    if (exportResponse.entityType !== "product_search_texts") {
      return 0;
    }

    const normalizedItems = Array.from(
      new Map(
        exportResponse.payload.products
          .filter((product) => Number.isInteger(product.nmId) && product.nmId > 0)
          .map((product) => [
            product.nmId,
            {
              nmId: product.nmId,
              vendorCode: product.vendorCode.trim(),
              name: product.name.trim() || product.vendorCode.trim() || `nmId ${String(product.nmId)}`,
              brandName: product.brandName.trim() || "-",
              subjectName: product.subjectName.trim() || "-",
            },
          ]),
      ).values(),
    ).filter((item) => item.vendorCode.length > 0);

    if (normalizedItems.length === 0) {
      return 0;
    }

    const upsertedCount = await this.wbClustersRepository.upsertProductCatalogItems({
      items: normalizedItems,
      sourceExportRequestId: exportResponse.requestId,
      seenAt: exportResponse.exportedAt,
    });
    this.logger.log(
      `Upserted ${String(upsertedCount)} product catalog rows from export ${exportResponse.requestId}.`,
    );
    return upsertedCount;
  }

  /**
   * Downloads ALL seller product cards from WB Content API v2 and upserts them
   * into wb_product_catalog. Runs on startup and hourly to ensure every advertised
   * product has a real vendorCode (артикул продавца).
   *
   * Uses cursor-based pagination — fetches 100 cards per page until the API
   * returns fewer than 100 (last page). No artificial page cap.
   */
  async syncMissingVendorCodesFromContentApi(): Promise<number> {
    if (this.contentSyncRunning) {
      this.logger.debug("Content API sync already running — skipping duplicate trigger.");
      return 0;
    }

    const token = this.wbRuntimeConfigService.getResolvedToken();
    if (!token) {
      this.logger.warn("WB token not configured — skipping Content API vendor code sync.");
      return 0;
    }

    this.contentSyncRunning = true;
    let totalSynced = 0;

    try {
      this.logger.log("Starting full Content API product card sync...");

      let cursor: { updatedAt?: string; nmID?: number } | null = null;
      let pagesFetched = 0;

      while (true) {
        const body: Record<string, unknown> = {
          settings: {
            cursor: cursor
              ? { limit: 100, updatedAt: cursor.updatedAt, nmID: cursor.nmID }
              : { limit: 100 },
            filter: { withPhoto: -1 },
            sort: { ascending: false },
          },
        };

        let data: ContentApiResponse;
        try {
          const response = await fetch(WB_CONTENT_API_CARDS_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30_000),
          });

          if (!response.ok) {
            const text = await response.text().catch(() => "");
            this.logger.warn(
              `Content API responded ${String(response.status)}: ${text.slice(0, 200)} — stopping sync.`,
            );
            break;
          }

          data = (await response.json()) as ContentApiResponse;
        } catch (err) {
          this.logger.warn(
            `Content API request failed: ${err instanceof Error ? err.message : String(err)} — stopping sync.`,
          );
          break;
        }

        const cards = data.cards ?? [];
        pagesFetched += 1;

        // Filter and map valid cards that have both nmID and a non-empty vendorCode.
        const validItems = cards
          .filter(
            (c): c is WbContentCardRaw & { nmID: number; vendorCode: string } =>
              typeof c.nmID === "number" &&
              c.nmID > 0 &&
              typeof c.vendorCode === "string" &&
              c.vendorCode.trim().length > 0,
          )
          .map((c) => ({
            nmId: c.nmID,
            vendorCode: c.vendorCode.trim(),
            name: (c.title ?? "").trim() || c.vendorCode.trim(),
            brandName: (c.brand ?? "").trim() || "-",
            subjectName: (c.subjectName ?? "").trim() || "-",
          }));

        if (validItems.length > 0) {
          const upserted = await this.wbClustersRepository.upsertProductCatalogItems({
            items: validItems,
            sourceExportRequestId: "content-api-full-sync",
            seenAt: new Date().toISOString(),
          });
          totalSynced += upserted;
        }

        // Pagination: if fewer than 100 cards returned, this is the last page.
        if (cards.length < 100 || !data.cursor) {
          break;
        }

        cursor = {
          updatedAt: data.cursor.updatedAt,
          nmID: data.cursor.nmID,
        };

        // Rate-limit: WB Content API allows ~5 req/sec — 250ms keeps us safe.
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }

      this.logger.log(
        `Content API sync complete: ${String(totalSynced)} rows upserted across ${String(pagesFetched)} pages.`,
      );
    } finally {
      this.contentSyncRunning = false;
    }

    return totalSynced;
  }
}
