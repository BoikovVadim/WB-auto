import { normalizeBidFromWb } from "./wb-clusters-queue.helpers";
import type { SearchQueryTextView } from "../wb-sync/wb-sync.types";
import {
  addAdvertisingSheetDays as addAdvertisingSheetDaysValue,
  formatAdvertisingSheetDate as formatAdvertisingSheetDateValue,
  getAdvertisingSheetStartOfDayTimestamp as getAdvertisingSheetStartOfDayTimestampValue,
  parseAdvertisingSheetDayValue as parseAdvertisingSheetDayValueValue,
} from "./product-advertising-sheet.codec";
import {
  buildAdvertisingSheetSearchQueriesPeriod as buildAdvertisingSheetSearchQueriesPeriodValue,
  normalizeAdvertisingSheetJamRange as normalizeAdvertisingSheetJamRangeValue,
} from "./product-advertising-sheet.builder";
import { mergeAdvertisingSheetSearchTextItems } from "./product-advertising-sheet.snapshot";

type WbClustersService = any;

export function deduplicateProductAdvertisingSearchTexts(
  self: WbClustersService,
  rows: SearchQueryTextView[],
) {
  const deduplicated = new Map();
  for (const row of rows) {
    const key = self.normalizeAdvertisingText(row.text);
    const existing = deduplicated.get(key);
    deduplicated.set(key, existing ? mergeAdvertisingSheetSearchTextItems(existing, row) : row);
  }
  return Array.from(deduplicated.values());
}

export function normalizeAdvertisingSheetJamRange(
  self: WbClustersService,
  startDate: string,
  endDate: string,
) {
  return normalizeAdvertisingSheetJamRangeValue({
    startDate,
    endDate,
    parseAdvertisingSheetDayValue: (value) => self.parseAdvertisingSheetDayValue(value),
    formatAdvertisingSheetDate: (value) => self.formatAdvertisingSheetDate(value),
  });
}

export function buildAdvertisingSheetSearchQueriesPeriod(
  self: WbClustersService,
  currentPeriod: { start: string; end: string },
) {
  return buildAdvertisingSheetSearchQueriesPeriodValue({
    currentPeriod,
    parseAdvertisingSheetDayValue: (value) => self.parseAdvertisingSheetDayValue(value),
    getAdvertisingSheetStartOfDayTimestamp: (value) =>
      self.getAdvertisingSheetStartOfDayTimestamp(value),
    addAdvertisingSheetDays: (value, amount) => self.addAdvertisingSheetDays(value, amount),
    formatAdvertisingSheetDate: (value) => self.formatAdvertisingSheetDate(value),
  });
}

export function formatAdvertisingSheetDate(self: WbClustersService, value: Date) {
  return formatAdvertisingSheetDateValue(value);
}

export function addAdvertisingSheetDays(
  self: WbClustersService,
  value: Date,
  days: number,
) {
  return addAdvertisingSheetDaysValue(value, days);
}

export function parseAdvertisingSheetDayValue(
  self: WbClustersService,
  value: string,
) {
  return parseAdvertisingSheetDayValueValue(value);
}

export function getAdvertisingSheetStartOfDayTimestamp(
  self: WbClustersService,
  value: Date,
) {
  return getAdvertisingSheetStartOfDayTimestampValue(value);
}

export function readOptionalString(self: WbClustersService, value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeSearchBidFromWb(self: WbClustersService, value: unknown) {
  const numericValue = self.toNullableNumber(value);
  if (numericValue === null) {
    return null;
  }

  return normalizeBidFromWb(numericValue / 100);
}

export function toNullableNumber(self: WbClustersService, value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
