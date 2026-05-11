import type { ProductAdvertisingSheetResponse } from "./types/product-advertising-sheet.types";

export function normalizeRequestedRangeBounds(startDate: string | null, endDate: string | null) {
  const parsedStart = parseDay(startDate);
  const parsedEnd = parseDay(endDate ?? startDate);
  if (!parsedStart || !parsedEnd) {
    return null;
  }

  return {
    startDate: formatDay(Math.min(parsedStart.getTime(), parsedEnd.getTime())),
    endDate: formatDay(Math.max(parsedStart.getTime(), parsedEnd.getTime())),
    startTime: Math.min(parsedStart.getTime(), parsedEnd.getTime()),
    endTime: Math.max(parsedStart.getTime(), parsedEnd.getTime()),
  };
}

export function getDailyStatsDateBounds(
  dailyStats: ProductAdvertisingSheetResponse["dailyStats"],
) {
  let startTime: number | null = null;
  let endTime: number | null = null;

  for (const item of dailyStats) {
    const parsedDay = parseDay(item.date);
    if (!parsedDay) {
      continue;
    }

    const dayTime = parsedDay.getTime();
    startTime = startTime === null ? dayTime : Math.min(startTime, dayTime);
    endTime = endTime === null ? dayTime : Math.max(endTime, dayTime);
  }

  if (startTime === null || endTime === null) {
    return null;
  }

  return {
    startDate: formatDay(startTime),
    endDate: formatDay(endTime),
    startTime,
    endTime,
  };
}

function parseDay(value: string | null) {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

export function formatDay(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

