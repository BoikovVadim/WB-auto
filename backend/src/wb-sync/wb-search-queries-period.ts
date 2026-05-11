import { HttpException, HttpStatus } from "@nestjs/common";

import type { SearchQueriesPeriod } from "./wb-sync.types";

export function getDefaultSearchQueriesPeriod(): SearchQueriesPeriod {
  const today = new Date();
  const localToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  return {
    currentStart: formatDate(addDays(localToday, -7)),
    currentEnd: formatDate(addDays(localToday, -1)),
    pastStart: formatDate(addDays(localToday, -14)),
    pastEnd: formatDate(addDays(localToday, -8)),
  };
}

export function resolveSearchQueriesPeriod(
  customPayload: Record<string, unknown> | undefined,
): SearchQueriesPeriod {
  const requestedCurrentPeriod =
    isRecord(customPayload) && isRecord(customPayload.currentPeriod)
      ? customPayload.currentPeriod
      : null;
  if (
    requestedCurrentPeriod &&
    typeof requestedCurrentPeriod.start === "string" &&
    typeof requestedCurrentPeriod.end === "string"
  ) {
    return buildSearchQueriesPeriodFromCurrentRange({
      start: requestedCurrentPeriod.start,
      end: requestedCurrentPeriod.end,
    });
  }

  return getDefaultSearchQueriesPeriod();
}

export function normalizeDateRange(startDate: string, endDate: string) {
  const start = parseDayValue(startDate);
  const end = parseDayValue(endDate);
  if (!start || !end) {
    throw new HttpException("Invalid date range.", HttpStatus.BAD_REQUEST);
  }

  const normalizedStart = start.getTime() <= end.getTime() ? start : end;
  const normalizedEnd = end.getTime() >= start.getTime() ? end : start;

  return {
    start: formatDate(normalizedStart),
    end: formatDate(normalizedEnd),
  };
}

export function buildSearchQueriesPeriodFromCurrentRange(currentPeriod: {
  start: string;
  end: string;
}): SearchQueriesPeriod {
  const startDate = parseDayValue(currentPeriod.start);
  const endDate = parseDayValue(currentPeriod.end);
  if (!startDate || !endDate) {
    throw new HttpException("Invalid date range.", HttpStatus.BAD_REQUEST);
  }

  const durationDays =
    Math.max(
      1,
      Math.round(
        (getStartOfDayTimestamp(endDate) - getStartOfDayTimestamp(startDate)) /
          (24 * 60 * 60 * 1000),
      ) + 1,
    );
  const pastEnd = addDays(startDate, -1);
  const pastStart = addDays(pastEnd, -(durationDays - 1));

  return {
    currentStart: currentPeriod.start,
    currentEnd: currentPeriod.end,
    pastStart: formatDate(pastStart),
    pastEnd: formatDate(pastEnd),
  };
}

function formatDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function parseDayValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getStartOfDayTimestamp(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
