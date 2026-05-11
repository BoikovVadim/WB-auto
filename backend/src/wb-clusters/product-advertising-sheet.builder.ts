import { BadRequestException } from "@nestjs/common";

import type { ProductAdvertisingSheetResponse } from "./wb-clusters.types";

export interface ProductAdvertisingSheetJamClusterOverlay {
  jamQueryCount: number | null;
  jamFrequency: number | null;
  jamClicks: number | null;
  jamAddToCart: number | null;
  jamOrders: number | null;
  jamAvgPosition: number | null;
}

export interface ProductAdvertisingSheetJamQueryOverlay {
  jamFrequency: number | null;
  jamClicks: number | null;
  jamAddToCart: number | null;
  jamOrders: number | null;
  jamAvgPosition: number | null;
  jamOpenToCart: number | null;
}

export interface ProductAdvertisingSheetJamOverlay {
  clusterMetricsByKey: Map<string, ProductAdvertisingSheetJamClusterOverlay>;
  queryMetricsByKey: Map<string, ProductAdvertisingSheetJamQueryOverlay>;
  extraQueries: ProductAdvertisingSheetResponse["clusterQueries"];
}

export function withEmptyJamMetrics(
  sheet: ProductAdvertisingSheetResponse,
): ProductAdvertisingSheetResponse {
  return {
    ...sheet,
    clusters: sheet.clusters.map((cluster) => ({
      ...cluster,
      jamQueryCount: cluster.jamQueryCount ?? null,
      jamFrequency: cluster.jamFrequency ?? null,
      jamClicks: cluster.jamClicks ?? null,
      jamAddToCart: cluster.jamAddToCart ?? null,
      jamOrders: cluster.jamOrders ?? null,
      jamAvgPosition: cluster.jamAvgPosition ?? null,
    })),
    clusterQueries: sheet.clusterQueries.map((query) => ({
      ...query,
      jamFrequency: query.jamFrequency ?? null,
      jamClicks: query.jamClicks ?? null,
      jamAddToCart: query.jamAddToCart ?? null,
      jamOrders: query.jamOrders ?? null,
      jamAvgPosition: query.jamAvgPosition ?? null,
      jamOpenToCart: query.jamOpenToCart ?? null,
    })),
  };
}

export function normalizeAdvertisingSheetJamRange(input: {
  startDate: string;
  endDate: string;
  parseAdvertisingSheetDayValue: (value: string) => Date | null;
  formatAdvertisingSheetDate: (value: Date) => string;
}) {
  const start = input.parseAdvertisingSheetDayValue(input.startDate);
  const end = input.parseAdvertisingSheetDayValue(input.endDate);
  if (!start || !end) {
    throw new BadRequestException("Invalid advertising sheet Jam date range.");
  }

  const normalizedStart = start.getTime() <= end.getTime() ? start : end;
  const normalizedEnd = end.getTime() >= start.getTime() ? end : start;
  return {
    start: input.formatAdvertisingSheetDate(normalizedStart),
    end: input.formatAdvertisingSheetDate(normalizedEnd),
  };
}

export function buildAdvertisingSheetSearchQueriesPeriod(input: {
  currentPeriod: { start: string; end: string };
  parseAdvertisingSheetDayValue: (value: string) => Date | null;
  getAdvertisingSheetStartOfDayTimestamp: (value: Date) => number;
  addAdvertisingSheetDays: (value: Date, amount: number) => Date;
  formatAdvertisingSheetDate: (value: Date) => string;
}) {
  const startDate = input.parseAdvertisingSheetDayValue(input.currentPeriod.start);
  const endDate = input.parseAdvertisingSheetDayValue(input.currentPeriod.end);
  if (!startDate || !endDate) {
    throw new BadRequestException("Invalid advertising sheet Jam date range.");
  }

  const durationDays =
    Math.max(
      1,
      Math.round(
        (input.getAdvertisingSheetStartOfDayTimestamp(endDate) -
          input.getAdvertisingSheetStartOfDayTimestamp(startDate)) /
          (24 * 60 * 60 * 1000),
      ) + 1,
    );
  const pastEnd = input.addAdvertisingSheetDays(startDate, -1);
  const pastStart = input.addAdvertisingSheetDays(pastEnd, -(durationDays - 1));

  return {
    currentStart: input.currentPeriod.start,
    currentEnd: input.currentPeriod.end,
    pastStart: input.formatAdvertisingSheetDate(pastStart),
    pastEnd: input.formatAdvertisingSheetDate(pastEnd),
  };
}
