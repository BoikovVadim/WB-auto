import { Inject, Injectable } from "@nestjs/common";

import { WbClustersService } from "../wb-clusters/wb-clusters.service";
import { buildRawTableView } from "./wb-raw-table-view";
import { WbApiClient } from "./wb-api.client";
import { writeWbExportJsonFile } from "./wb-export-archive.store";
import {
  buildExportProductIndex,
  extractSearchTextItems,
  extractSummaryProducts,
  normalizeClusterLookupKey,
  normalizeSearchTextItem,
  normalizeSummaryProduct,
  readNumber,
  sortRawSearchTextRowsByOpenCard,
  sortSearchTextsByOpenCard,
  upsertSearchTextItem,
} from "./wb-search-queries-payload.helpers";
import {
  getBooleanValue,
  getBoundedNumber,
  getOptionalSummaryFilters,
  getPositionCluster,
  getSummaryOrderBy,
  getTopOrderByVariants,
} from "./wb-search-queries-request-options";
import type {
  SearchQueriesExportPayload,
  SearchQueriesPeriod,
  SearchQueryTextView,
} from "./wb-sync.types";

@Injectable()
export class WbSearchQueriesExportService {
  constructor(
    @Inject(WbApiClient)
    private readonly wbApiClient: WbApiClient,
    @Inject(WbClustersService)
    private readonly wbClustersService: WbClustersService,
  ) {}

  async exportSearchQueries(
    period: SearchQueriesPeriod,
    customPayload: Record<string, unknown> | undefined,
    rawArchivePath: string,
  ): Promise<SearchQueriesExportPayload> {
    return this.buildSearchQueriesPayload(period, customPayload, rawArchivePath);
  }

  async exportProductSearchTexts(
    period: SearchQueriesPeriod,
    customPayload: Record<string, unknown> | undefined,
    rawArchivePath: string,
  ): Promise<SearchQueriesExportPayload> {
    const nextPayload = {
      ...(customPayload ?? {}),
      includeSearchTexts: true,
      topOrderBy: "openCard",
      searchTextsLimit: getBoundedNumber(customPayload?.searchTextsLimit, 30, 1, 30),
    };

    const payload = await this.buildSearchQueriesPayload(
      period,
      nextPayload,
      rawArchivePath,
    );

    return {
      ...payload,
      products: payload.products.map((product) => ({
        ...product,
        searchTexts: sortSearchTextsByOpenCard(product.searchTexts),
      })),
      wbTables:
        payload.wbTables
          ?.filter((table) => table.id === "wb-search-texts")
          .map((table) =>
            buildRawTableView({
              id: table.id,
              title: table.title,
              rows: sortRawSearchTextRowsByOpenCard(table.rows),
            }),
          ) ?? [],
    };
  }

  private async buildSearchQueriesPayload(
    period: SearchQueriesPeriod,
    customPayload: Record<string, unknown> | undefined,
    rawArchivePath: string,
  ): Promise<SearchQueriesExportPayload> {
    const { summaryProducts, pagesFetched } = await this.fetchSummaryProducts(
      period,
      customPayload,
      rawArchivePath,
    );
    const searchTextsResult = await this.fetchSearchTextsByProducts(
      period,
      summaryProducts,
      customPayload,
      rawArchivePath,
    );
    const searchTextsByNmId = searchTextsResult.byNmId;
    await this.enrichSearchTextsWithClusters(searchTextsByNmId);

    const products = summaryProducts.map((product) =>
      normalizeSummaryProduct(product, searchTextsByNmId),
    );
    const searchTextsCount = products.reduce(
      (total, product) => total + product.searchTexts.length,
      0,
    );

    return {
      period,
      summary: {
        productsCount: products.length,
        searchTextsCount,
        sourcePagesFetched: pagesFetched,
        productBatchesFetched: searchTextsResult.batchesFetched,
      },
      products,
      productIndex: buildExportProductIndex(products),
      wbTables: [
        buildRawTableView({
          id: "wb-summary-products",
          title: "Строки WB из report",
          rows: summaryProducts.filter((item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null,
          ),
        }),
        buildRawTableView({
          id: "wb-search-texts",
          title: "Строки WB из product/search-texts",
          rows: searchTextsResult.rawRows,
        }),
      ],
    };
  }

  private async fetchSummaryProducts(
    period: SearchQueriesPeriod,
    customPayload: Record<string, unknown> | undefined,
    rawArchivePath: string,
  ) {
    const summaryProducts: unknown[] = [];
    const pageLimit = getBoundedNumber(customPayload?.limit, 1000, 1, 1000);
    let offset = 0;
    let pageIndex = 0;

    while (true) {
      const body = {
        currentPeriod: {
          start: period.currentStart,
          end: period.currentEnd,
        },
        pastPeriod: {
          start: period.pastStart,
          end: period.pastEnd,
        },
        orderBy: getSummaryOrderBy(customPayload),
        positionCluster: getPositionCluster(customPayload),
        includeSubstitutedSKUs: getBooleanValue(
          customPayload?.includeSubstitutedSKUs,
          true,
        ),
        includeSearchTexts: getBooleanValue(
          customPayload?.includeSearchTexts,
          true,
        ),
        limit: pageLimit,
        offset,
        ...getOptionalSummaryFilters(customPayload),
      };
      const response = await this.wbApiClient.request({
        method: "POST",
        path: "/api/v2/search-report/report",
        body,
      });
      const pageProducts = extractSummaryProducts(response);

      await writeWbExportJsonFile(rawArchivePath, `summary-page-${pageIndex + 1}.json`, {
        request: body,
        response,
      });

      summaryProducts.push(...pageProducts);
      pageIndex += 1;

      if (pageProducts.length < pageLimit) {
        break;
      }

      offset += pageLimit;
    }

    return {
      summaryProducts,
      pagesFetched: pageIndex,
    };
  }

  private async fetchSearchTextsByProducts(
    period: SearchQueriesPeriod,
    summaryProducts: unknown[],
    customPayload: Record<string, unknown> | undefined,
    rawArchivePath: string,
  ) {
    const nmIds = summaryProducts
      .map((product) => readNumber(product, "nmId"))
      .filter((value): value is number => value !== null);
    const uniqueNmIds = [...new Set(nmIds)];
    const productBatches = this.chunk(uniqueNmIds, 50);
    const batchLimit = getBoundedNumber(customPayload?.searchTextsLimit, 30, 1, 30);
    const result = new Map<number, Map<string, SearchQueryTextView>>();
    const rawRows: Record<string, unknown>[] = [];
    let batchIndex = 0;

    for (const batch of productBatches) {
      for (const topOrderBy of getTopOrderByVariants(customPayload)) {
        const body = {
          currentPeriod: {
            start: period.currentStart,
            end: period.currentEnd,
          },
          pastPeriod: {
            start: period.pastStart,
            end: period.pastEnd,
          },
          nmIds: batch,
          topOrderBy,
          includeSubstitutedSKUs: getBooleanValue(
            customPayload?.includeSubstitutedSKUs,
            true,
          ),
          includeSearchTexts: getBooleanValue(
            customPayload?.includeSearchTexts,
            true,
          ),
          orderBy: getSummaryOrderBy(customPayload),
          limit: batchLimit,
        };
        const response = await this.wbApiClient.request({
          method: "POST",
          path: "/api/v2/search-report/product/search-texts",
          body,
        });
        const items = extractSearchTextItems(response);

        await writeWbExportJsonFile(
          rawArchivePath,
          `search-texts-batch-${batchIndex + 1}-${topOrderBy}.json`,
          {
            request: body,
            response,
          },
        );

        for (const item of items) {
          if (typeof item === "object" && item !== null) {
            rawRows.push(item as Record<string, unknown>);
          }

          const nmId = readNumber(item, "nmId");
          if (nmId === null) {
            continue;
          }

          upsertSearchTextItem(result, nmId, normalizeSearchTextItem(item));
        }

        batchIndex += 1;
      }
    }

    return {
      byNmId: new Map(
        Array.from(result.entries()).map(([currentNmId, itemsByText]) => [
          currentNmId,
          Array.from(itemsByText.values()),
        ]),
      ),
      rawRows,
      batchesFetched: batchIndex,
    };
  }

  private async enrichSearchTextsWithClusters(
    searchTextsByNmId: Map<number, SearchQueryTextView[]>,
  ) {
    for (const [nmId, searchTexts] of searchTextsByNmId.entries()) {
      const uniqueQueries = [
        ...new Set(
          searchTexts
            .map((item) => item.text.trim())
            .filter((value) => value.length > 0),
        ),
      ];

      if (uniqueQueries.length === 0) {
        continue;
      }

      try {
        const lookup = await this.wbClustersService.lookupProductClusters(
          nmId,
          uniqueQueries,
        );
        const matches = new Map(
          lookup.matches.map((item) => [item.queryText, item.clusterName]),
        );

        for (const item of searchTexts) {
          item.wbCluster = matches.get(normalizeClusterLookupKey(item.text)) ?? null;
        }
      } catch {
        for (const item of searchTexts) {
          item.wbCluster = null;
        }
      }
    }
  }

  private chunk(values: number[], size: number) {
    const result: number[][] = [];

    for (let index = 0; index < values.length; index += size) {
      result.push(values.slice(index, index + size));
    }

    return result;
  }
}
