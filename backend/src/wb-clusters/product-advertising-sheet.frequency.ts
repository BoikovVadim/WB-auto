import type { ProductAdvertisingSheetResponse } from "./types/product-advertising-sheet.types";
import { isAggregateSafeAdvertisingSheetClusterQuery } from "./product-advertising-sheet.snapshot.jam.search-text";

export function buildAggregateSafeClusterFrequencyIndex(input: {
  clusterQueries: ProductAdvertisingSheetResponse["clusterQueries"];
  normalizeAdvertisingText: (value: string) => string;
}) {
  const frequencyByGroupKey = new Map<string, number>();

  for (const query of input.clusterQueries) {
    if (
      query.monthlyFrequency === null ||
      !isAggregateSafeAdvertisingSheetClusterQuery(query, input.normalizeAdvertisingText)
    ) {
      continue;
    }

    const groupKey = buildAggregateSafeClusterFrequencyGroupKey(
      query.advertId,
      query.clusterName,
      input.normalizeAdvertisingText,
    );
    frequencyByGroupKey.set(groupKey, (frequencyByGroupKey.get(groupKey) ?? 0) + query.monthlyFrequency);
  }

  return frequencyByGroupKey;
}

export function buildAggregateSafeClusterFrequencyGroupKey(
  advertId: number,
  clusterName: string,
  normalizeAdvertisingText: (value: string) => string,
) {
  return `${String(advertId)}:${normalizeAdvertisingText(clusterName)}`;
}
