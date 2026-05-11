import type { SearchQueryTextView } from "../wb-sync/wb-sync.types";
import type {
  ProductAdvertisingSheetJamOverlay,
  ProductAdvertisingSheetJamQueryOverlay,
} from "./product-advertising-sheet.builder";
import type { ProductClusterLookupMatch } from "./types/catalog.types";
import type { ProductAdvertisingSheetResponse } from "./types/product-advertising-sheet.types";

import {
  buildAdvertisingSheetJamGroupKey,
  buildAdvertisingSheetJamQueryKey,
} from "./product-advertising-sheet.snapshot.jam.keys";
import {
  buildAdvertisingSheetJamSearchTextLookup,
  isAggregateSafeAdvertisingSheetClusterQuery,
} from "./product-advertising-sheet.snapshot.jam.search-text";

export function buildProductAdvertisingSheetJamOverlay(input: {
  sheet: ProductAdvertisingSheetResponse;
  searchTexts: SearchQueryTextView[];
  lookupMatches: ProductClusterLookupMatch[];
  normalizeAdvertisingText: (value: string) => string;
}): ProductAdvertisingSheetJamOverlay {
  if (input.searchTexts.length === 0) {
    return {
      clusterMetricsByKey: new Map(),
      queryMetricsByKey: new Map(),
      extraQueries: [],
    };
  }

  const lookupMap = new Map(
    input.lookupMatches.map((match) => [
      input.normalizeAdvertisingText(match.queryText),
      match,
    ]),
  );
  const jamSearchTextLookup = buildAdvertisingSheetJamSearchTextLookup(
    input.searchTexts,
    input.normalizeAdvertisingText,
  );
  const queryMetricsByKey = new Map<string, ProductAdvertisingSheetJamQueryOverlay>();
  const extraQueries: ProductAdvertisingSheetResponse["clusterQueries"] = [];

  for (const query of input.sheet.clusterQueries) {
    const jamSearchText = jamSearchTextLookup.get(input.normalizeAdvertisingText(query.queryText));
    queryMetricsByKey.set(
      buildAdvertisingSheetJamQueryKey(
        query.advertId,
        query.clusterName,
        query.queryText,
        input.normalizeAdvertisingText,
      ),
      {
        jamFrequency: jamSearchText?.frequency ?? null,
        jamClicks: jamSearchText?.openCard ?? null,
        jamAddToCart: jamSearchText?.addToCart ?? null,
        jamOrders: jamSearchText?.orders ?? null,
        jamAvgPosition: jamSearchText?.avgPosition ?? null,
        jamOpenToCart: jamSearchText?.openToCart ?? null,
      },
    );
  }

  const existingQueryKeys = new Set(queryMetricsByKey.keys());
  for (const searchText of input.searchTexts) {
    const normalizedQueryText = input.normalizeAdvertisingText(searchText.text);
    if (!normalizedQueryText) {
      continue;
    }

    const lookupMatch = lookupMap.get(normalizedQueryText);
    if (!lookupMatch || lookupMatch.advertId === null) {
      continue;
    }

    const queryKey = buildAdvertisingSheetJamQueryKey(
      lookupMatch.advertId,
      lookupMatch.clusterName,
      searchText.text,
      input.normalizeAdvertisingText,
    );
    if (existingQueryKeys.has(queryKey)) {
      continue;
    }

    const overlay = {
      jamFrequency: searchText.frequency,
      jamClicks: searchText.openCard.current,
      jamAddToCart: searchText.addToCart.current,
      jamOrders: searchText.orders.current,
      jamAvgPosition: searchText.avgPosition.current,
      jamOpenToCart: searchText.openToCart.current,
    };
    queryMetricsByKey.set(queryKey, overlay);
    existingQueryKeys.add(queryKey);
    extraQueries.push({
      advertId: lookupMatch.advertId,
      clusterName: lookupMatch.clusterName,
      queryText: searchText.text,
      querySource: "query-map",
      mappingSource: lookupMatch.mappingSource,
      matchConfidence:
        lookupMatch.mappingSource === "cluster-name" ? "exact" : "trusted-source",
      isFrequencyBacked: false,
      isClusterConfirmed: true,
      isCanonicalClusterQuery: true,
      isCabinetBacked:
        lookupMatch.mappingSource === "cabinet" || lookupMatch.mappingSource === "merged",
      cabinetSnapshotAt: null,
      sourceKind: lookupMatch.sourceKind,
      isActive: lookupMatch.isActive,
      views: lookupMatch.views,
      clicks: lookupMatch.clicks,
      orders: lookupMatch.orders,
      addToCart: lookupMatch.addToCart,
      shks: lookupMatch.shks,
      jamFrequency: overlay.jamFrequency,
      jamClicks: overlay.jamClicks,
      jamAddToCart: overlay.jamAddToCart,
      jamOrders: overlay.jamOrders,
      jamAvgPosition: overlay.jamAvgPosition,
      jamOpenToCart: overlay.jamOpenToCart,
      monthlyFrequency: null,
      updatedAt: lookupMatch.updatedAt,
    });
  }

  const clusterMetricsByKey = new Map<
    string,
    {
      jamQueryCount: number;
      jamFrequency: number;
      jamClicks: number;
      jamAddToCart: number;
      jamOrders: number;
      jamAvgPositionSum: number;
      jamAvgPositionCount: number;
    }
  >();
  const seenGroupQueries = new Set<string>();
  const aggregateQueries = [...input.sheet.clusterQueries, ...extraQueries];

  for (const query of aggregateQueries) {
    if (
      !query.isCanonicalClusterQuery ||
      !isAggregateSafeAdvertisingSheetClusterQuery(query, input.normalizeAdvertisingText)
    ) {
      continue;
    }

    const normalizedQueryText = input.normalizeAdvertisingText(query.queryText);
    const groupKey = buildAdvertisingSheetJamGroupKey(
      query.advertId,
      query.clusterName,
      input.normalizeAdvertisingText,
    );
    const seenKey = `${groupKey}:${normalizedQueryText}`;
    if (seenGroupQueries.has(seenKey)) {
      continue;
    }

    seenGroupQueries.add(seenKey);
    const metrics =
      queryMetricsByKey.get(
        buildAdvertisingSheetJamQueryKey(
          query.advertId,
          query.clusterName,
          query.queryText,
          input.normalizeAdvertisingText,
        ),
      ) ?? null;
    const aggregate = clusterMetricsByKey.get(groupKey) ?? {
      jamQueryCount: 0,
      jamFrequency: 0,
      jamClicks: 0,
      jamAddToCart: 0,
      jamOrders: 0,
      jamAvgPositionSum: 0,
      jamAvgPositionCount: 0,
    };

    const isJamFrequencyBackedByMonthlyFrequency = query.monthlyFrequency !== null;
    if (isJamFrequencyBackedByMonthlyFrequency) {
      aggregate.jamQueryCount += 1;
      aggregate.jamFrequency += metrics?.jamFrequency ?? 0;
    }
    aggregate.jamClicks += metrics?.jamClicks ?? 0;
    aggregate.jamAddToCart += metrics?.jamAddToCart ?? 0;
    aggregate.jamOrders += metrics?.jamOrders ?? 0;
    if (typeof metrics?.jamAvgPosition === "number") {
      aggregate.jamAvgPositionSum += metrics.jamAvgPosition;
      aggregate.jamAvgPositionCount += 1;
    }

    clusterMetricsByKey.set(groupKey, aggregate);
  }

  return {
    clusterMetricsByKey: new Map(
      Array.from(clusterMetricsByKey.entries()).map(([key, value]) => [
        key,
        {
          jamQueryCount: value.jamQueryCount,
          jamFrequency: value.jamFrequency,
          jamClicks: value.jamClicks,
          jamAddToCart: value.jamAddToCart,
          jamOrders: value.jamOrders,
          jamAvgPosition:
            value.jamAvgPositionCount > 0
              ? value.jamAvgPositionSum / value.jamAvgPositionCount
              : null,
        },
      ]),
    ),
    queryMetricsByKey,
    extraQueries,
  };
}
