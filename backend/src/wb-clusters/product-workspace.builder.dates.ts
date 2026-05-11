import type { ProductAdvertisingSheetResponse } from "./wb-clusters.types";

type WorkspaceDailyStat = ProductAdvertisingSheetResponse["dailyStats"][number];

export function getWorkspaceDailyStatsBounds(
  dailyStats: ProductAdvertisingSheetResponse["dailyStats"],
) {
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const item of dailyStats) {
    const parsedDate = parseWorkspaceDay(item.date);
    if (!parsedDate) {
      continue;
    }

    const normalizedDate = formatWorkspaceDay(parsedDate);
    if (!minDate || normalizedDate < minDate) {
      minDate = normalizedDate;
    }
    if (!maxDate || normalizedDate > maxDate) {
      maxDate = normalizedDate;
    }
  }

  return {
    minDate,
    maxDate,
  };
}

export function isWorkspaceStatDateWithinRange(
  stat: WorkspaceDailyStat,
  startDate: string | null,
  endDate: string | null,
) {
  const parsedDate = parseWorkspaceDay(stat.date);
  if (!parsedDate) {
    return false;
  }

  const currentValue = parsedDate.getTime();
  const safeStart = startDate
    ? parseWorkspaceDay(startDate)?.getTime() ?? Number.NEGATIVE_INFINITY
    : Number.NEGATIVE_INFINITY;
  const safeEnd = endDate
    ? parseWorkspaceDay(endDate)?.getTime() ?? Number.POSITIVE_INFINITY
    : safeStart;

  return currentValue >= Math.min(safeStart, safeEnd) && currentValue <= Math.max(safeStart, safeEnd);
}

export function parseWorkspaceDay(value: string) {
  const matchedValue = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (matchedValue) {
    const [, year, month, day] = matchedValue;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime())
    ? null
    : new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
}

export function formatWorkspaceDay(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${String(year)}-${month}-${day}`;
}

export function pickLatestIsoDate(currentValue: string | null, nextValue: string | null) {
  if (!currentValue) {
    return nextValue;
  }
  if (!nextValue) {
    return currentValue;
  }

  return Date.parse(nextValue) > Date.parse(currentValue) ? nextValue : currentValue;
}
