import { appEnv } from "../common/env";
import type { SearchQueryTextView } from "../wb-sync/wb-sync.types";
import { tryReadStoredWbExport } from "../wb-sync/wb-export-archive.store";
import { loadProductSearchTextsRangeByNmId } from "../wb-sync/product-search-texts-range";

type WbClustersService = any;
type SearchTextSeedItem = {
  nmId: number;
  rows: SearchQueryTextView[];
};

export async function loadProductAdvertisingSheetSearchTextsRange(
  self: WbClustersService,
  nmId: number,
  currentPeriod: { start: string; end: string },
  allowLiveFetch: boolean,
) {
  const storedSearchTexts = await self.wbClustersRepository.getStoredProductSearchTextRange({
    nmId,
    startDate: currentPeriod.start,
    endDate: currentPeriod.end,
  });
  if (storedSearchTexts) {
    return storedSearchTexts;
  }

  if (!allowLiveFetch) {
    self.logger.log(
      `Advertising sheet Jam range is not materialized yet for nm ${nmId} (${currentPeriod.start}..${currentPeriod.end}); returning DB-only pending state.`,
    );
    return [];
  }

  const searchTexts = await loadProductSearchTextsRangeByNmId({
    nmId,
    currentPeriod,
    request: (body) =>
      self.wbApiClient.request({
        method: "POST",
        path: "/api/v2/search-report/product/search-texts",
        timeoutMs: Math.max(appEnv.wbApiTimeoutMs, 120_000),
        retryAttempts: 0,
        body,
      }),
    preferredTopOrderBy: "openCard",
    limit: 30,
  });
  await self.wbClustersRepository.replaceStoredProductSearchTextRange({
    nmId,
    startDate: currentPeriod.start,
    endDate: currentPeriod.end,
    rows: searchTexts,
  });
  return searchTexts;
}

export async function seedProductAdvertisingSearchTextRangesFromExport(
  self: WbClustersService,
  exportRequestId: string,
  nmIds: number[],
  explicitPeriod: { start: string; end: string },
) {
  const savedExport = await tryReadStoredWbExport(exportRequestId);
  if (!savedExport || savedExport.entityType !== "product_search_texts") {
    self.logger.warn(
      `Unable to seed product advertising search text ranges: export ${exportRequestId} was not found or has unsupported entity type.`,
    );
    return;
  }

  const exportPeriod = savedExport.payload.period;
  if (
    exportPeriod.currentStart !== explicitPeriod.start ||
    exportPeriod.currentEnd !== explicitPeriod.end
  ) {
    self.logger.warn(
      `Unable to seed product advertising search text ranges from export ${exportRequestId}: export period ${exportPeriod.currentStart}..${exportPeriod.currentEnd} does not match requested ${explicitPeriod.start}..${explicitPeriod.end}.`,
    );
    return;
  }

  const searchTextsByNmId = new Map(
    savedExport.payload.products.map((product) => [product.nmId, product.searchTexts]),
  );
  const rowsToSeed: SearchTextSeedItem[] = nmIds
    .map((nmId) => ({
      nmId,
      rows: searchTextsByNmId.get(nmId) ?? null,
    }))
    .filter((item): item is SearchTextSeedItem => Array.isArray(item.rows));

  const concurrency = 20;
  for (const chunk of self.chunkArray(rowsToSeed, concurrency) as SearchTextSeedItem[][]) {
    await Promise.all(
      chunk.map(({ nmId, rows }) => {
        const deduplicatedRows = self.deduplicateProductAdvertisingSearchTexts(rows);
        return self.wbClustersRepository.replaceStoredProductSearchTextRange({
          nmId,
          startDate: explicitPeriod.start,
          endDate: explicitPeriod.end,
          rows: deduplicatedRows,
        });
      }),
    );
  }

  self.logger.log(
    `Seeded ${rowsToSeed.length} product advertising search text ranges from export ${exportRequestId} for ${explicitPeriod.start}..${explicitPeriod.end}.`,
  );
}

export async function runExactProductPresetMaterializationFromExport(
  self: WbClustersService,
  exportRequestId: string,
  nmIds: number[],
  explicitPeriod: { start: string; end: string },
  reason: string,
) {
  await self.seedProductAdvertisingSearchTextRangesFromExport(
    exportRequestId,
    nmIds,
    explicitPeriod,
  );
  await self.materializeProductAdvertisingSheets(nmIds, reason, explicitPeriod);
}
