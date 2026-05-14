import type {
  ProductAdvertisingSheetResponse,
  SearchQueriesPeriod,
} from "../../../api/syncClient";

export type AdvertisingDateRange = {
  start: Date | null;
  end: Date | null;
};

export type AdvertisingDatePreset = "today" | "yesterday" | "week" | "month";

export type AdvertisingDateBounds = {
  min: Date;
  max: Date;
} | null;

export const calendarWeekdayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function resolveJamRangePeriod(
  range: AdvertisingDateRange,
  fallbackPeriod: SearchQueriesPeriod,
  bounds: AdvertisingDateBounds,
) {
  if (!range.start && !range.end) {
    if (bounds) {
      return {
        startDate: formatCalendarDateValue(bounds.min),
        endDate: formatCalendarDateValue(bounds.max),
        usesExportPeriod: false,
      };
    }

    return {
      startDate: fallbackPeriod.currentStart,
      endDate: fallbackPeriod.currentEnd,
      usesExportPeriod: true,
    };
  }

  const start = getStartOfCalendarDay(range.start ?? range.end ?? new Date());
  const end = getStartOfCalendarDay(range.end ?? range.start ?? new Date());
  const normalizedStart = start.getTime() <= end.getTime() ? start : end;
  const normalizedEnd = end.getTime() >= start.getTime() ? end : start;

  if (
    fallbackPeriod.currentStart === formatCalendarDateValue(normalizedStart) &&
    fallbackPeriod.currentEnd === formatCalendarDateValue(normalizedEnd)
  ) {
    return {
      startDate: fallbackPeriod.currentStart,
      endDate: fallbackPeriod.currentEnd,
      usesExportPeriod: true,
    };
  }

  return {
    startDate: formatCalendarDateValue(normalizedStart),
    endDate: formatCalendarDateValue(normalizedEnd),
    usesExportPeriod: false,
  };
}

export function formatAdvertisingDateRangeLabel(range: AdvertisingDateRange) {
  if (!range.start && !range.end) {
    return "Все даты";
  }

  if (range.start && !range.end) {
    return `${formatShortDate(range.start)} - ...`;
  }

  if (!range.start && range.end) {
    return `... - ${formatShortDate(range.end)}`;
  }

  return `${formatShortDate(range.start as Date)} - ${formatShortDate(range.end as Date)}`;
}

export function formatShortDate(value: Date) {
  return value.toLocaleDateString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatCalendarDateValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${String(year)}-${month}-${day}`;
}

export function formatAdvertisingMonthTitle(value: Date) {
  const label = value.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });

  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function getCalendarMonthStart(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

export function addCalendarDays(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount);
}

export function addCalendarMonths(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

export function addCalendarMonthsPreservingDay(value: Date, amount: number) {
  const targetYear = value.getFullYear();
  const targetMonth = value.getMonth() + amount;
  const lastTargetDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return new Date(targetYear, targetMonth, Math.min(value.getDate(), lastTargetDay));
}

export function getStartOfCalendarDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function isCalendarMonthDay(value: Date, monthStart: Date) {
  return (
    value.getFullYear() === monthStart.getFullYear() &&
    value.getMonth() === monthStart.getMonth()
  );
}

export function buildAdvertisingCalendarDays(monthStart: Date) {
  const monthFirstDay = getCalendarMonthStart(monthStart);
  const weekDayOffset = (monthFirstDay.getDay() + 6) % 7;
  const gridStart = addCalendarDays(monthFirstDay, -weekDayOffset);

  return Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index));
}

export function parseAdvertisingDayValue(value: string) {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (dayMatch) {
    const [, year, month, day] = dayMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : getStartOfCalendarDay(date);
}

export function getAdvertisingDailyStatsBounds(
  dailyStats: ProductAdvertisingSheetResponse["dailyStats"],
): AdvertisingDateBounds {
  let min: Date | null = null;
  let max: Date | null = null;

  for (const item of dailyStats) {
    const parsedDate = parseAdvertisingDayValue(item.date);
    if (!parsedDate) {
      continue;
    }

    if (!min || parsedDate.getTime() < min.getTime()) {
      min = parsedDate;
    }
    if (!max || parsedDate.getTime() > max.getTime()) {
      max = parsedDate;
    }
  }

  return min && max ? { min, max } : null;
}

export function isCalendarDayWithinRange(value: Date, range: AdvertisingDateRange) {
  if (!range.start) {
    return false;
  }

  const safeStart = getStartOfCalendarDay(range.start).getTime();
  const safeEnd = getStartOfCalendarDay(range.end ?? range.start).getTime();
  const currentValue = getStartOfCalendarDay(value).getTime();

  return currentValue >= Math.min(safeStart, safeEnd) && currentValue <= Math.max(safeStart, safeEnd);
}

export function isAdvertisingStatDateWithinRange(value: string, range: AdvertisingDateRange) {
  if (!range.start && !range.end) {
    return true;
  }

  const parsedDate = parseAdvertisingDayValue(value);
  if (!parsedDate) {
    return false;
  }

  const currentValue = getStartOfCalendarDay(parsedDate).getTime();
  const safeStart = range.start
    ? getStartOfCalendarDay(range.start).getTime()
    : Number.NEGATIVE_INFINITY;
  const safeEnd = range.end
    ? getStartOfCalendarDay(range.end).getTime()
    : safeStart;

  return currentValue >= Math.min(safeStart, safeEnd) && currentValue <= Math.max(safeStart, safeEnd);
}

export function isAdvertisingCalendarDayDisabled(
  day: Date,
  _bounds: AdvertisingDateBounds,
  allowAllPast = false,
) {
  const normalizedDay = getStartOfCalendarDay(day).getTime();
  const today = getStartOfCalendarDay(new Date());

  // Будущие даты всегда заблокированы.
  if (normalizedDay > today.getTime()) {
    return true;
  }

  // JAM и другие полноисторические режимы — любые прошлые даты доступны.
  if (allowAllPast) {
    return false;
  }

  // Стандартное поведение рекламного фильтра: доступен последний календарный
  // месяц — совпадает с периодом, за который WB отдаёт статистику.
  // Минимальная дата — то же число прошлого месяца (31 мая → 30 апреля).
  const minDate = addCalendarMonthsPreservingDay(today, -1);
  const normalizedMin = getStartOfCalendarDay(minDate).getTime();
  return normalizedDay < normalizedMin;
}

export function getTodayAdvertisingDateRange(): AdvertisingDateRange {
  const today = getStartOfCalendarDay(new Date());
  return {
    start: today,
    end: today,
  };
}

export function getAdvertisingDatePresetRange(
  preset: AdvertisingDatePreset,
): AdvertisingDateRange {
  const todayRange = getTodayAdvertisingDateRange();
  const today = todayRange.start as Date;

  if (preset === "today") {
    return todayRange;
  }

  if (preset === "yesterday") {
    const yesterday = addCalendarDays(today, -1);
    return { start: yesterday, end: yesterday };
  }

  if (preset === "week") {
    return {
      start: addCalendarDays(today, -6),
      end: today,
    };
  }

  if (preset === "month") {
    return {
      start: addCalendarMonthsPreservingDay(today, -1),
      end: today,
    };
  }

  return todayRange;
}

export function getDelayUntilNextHourBoundary(now = new Date()) {
  const nextBoundary = new Date(now.getTime());
  nextBoundary.setHours(nextBoundary.getHours() + 1, 0, 0, 0);

  return Math.max(1, nextBoundary.getTime() - now.getTime());
}
