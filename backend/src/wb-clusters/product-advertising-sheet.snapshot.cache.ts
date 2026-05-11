import type {
  ProductAdvertisingJamMaterializationStatus,
  ProductAdvertisingSheetResponse,
} from "./types/product-advertising-sheet.types";

export interface ProductAdvertisingSheetPeriod {
  start: string;
  end: string;
}

export function withProductAdvertisingRange(
  sheet: ProductAdvertisingSheetResponse,
  input: {
    startDate: string | null;
    endDate: string | null;
    jamIncluded: boolean;
    jamStatus: ProductAdvertisingJamMaterializationStatus;
  },
): ProductAdvertisingSheetResponse {
  return {
    ...sheet,
    range: {
      startDate: input.startDate,
      endDate: input.endDate,
      jamIncluded: input.jamIncluded,
      jamStatus: input.jamStatus,
    },
  };
}

export function buildProductAdvertisingSheetCacheKey(input: {
  nmId: number;
  currentPeriod: ProductAdvertisingSheetPeriod;
  cacheVersion: number;
}) {
  return `${String(input.nmId)}:v${String(input.cacheVersion)}:${input.currentPeriod.start}:${input.currentPeriod.end}`;
}

export function invalidateProductAdvertisingSheetCaches(input: {
  nmId: number;
  versionMap: Map<number, number>;
  caches: Array<Map<string, unknown>>;
}) {
  input.versionMap.set(input.nmId, (input.versionMap.get(input.nmId) ?? 0) + 1);

  const cachePrefix = `${String(input.nmId)}:`;
  for (const cache of input.caches) {
    for (const key of cache.keys()) {
      if (key.startsWith(cachePrefix)) {
        cache.delete(key);
      }
    }
  }
}

export function getHourlyProductAdvertisingWarmPeriods(input: {
  now: Date;
  parseAdvertisingSheetDayValue: (value: string) => Date | null;
  formatAdvertisingSheetDate: (value: Date) => string;
  addAdvertisingSheetDays: (value: Date, days: number) => Date;
}): ProductAdvertisingSheetPeriod[] {
  const today = input.parseAdvertisingSheetDayValue(
    input.formatAdvertisingSheetDate(input.now),
  );
  if (!today) {
    return [];
  }

  // Reduced to 3 periods (was 6) to limit peak memory during bulk materialization.
  // today-1/today-2/today-3 singles are materialized on-demand when the user views
  // them; the weekly and monthly ranges are the ones that benefit most from warm cache.
  return [
    {
      start: input.formatAdvertisingSheetDate(today),
      end: input.formatAdvertisingSheetDate(today),
    },
    {
      start: input.formatAdvertisingSheetDate(input.addAdvertisingSheetDays(today, -6)),
      end: input.formatAdvertisingSheetDate(today),
    },
    {
      start: input.formatAdvertisingSheetDate(input.addAdvertisingSheetDays(today, -29)),
      end: input.formatAdvertisingSheetDate(today),
    },
  ];
}
