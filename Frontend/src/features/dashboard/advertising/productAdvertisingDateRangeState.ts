import { formatCalendarDateValue, getAdvertisingDatePresetRange, type AdvertisingDateRange } from "./date";

// Default preset applied when no explicit date range is available.
// Used both on the first app load and when entering a product without
// a stored preference.
function getDefaultDateRange(): AdvertisingDateRange {
  return getAdvertisingDatePresetRange("week");
}

function normalizeExplicitDateRange(input: {
  persistedStartDate: Date | null;
  persistedEndDate: Date | null;
}): AdvertisingDateRange | null {
  if (!input.persistedStartDate && !input.persistedEndDate) {
    return null;
  }

  const start = input.persistedStartDate ?? input.persistedEndDate;
  const end = input.persistedEndDate ?? input.persistedStartDate;

  // A single-day range was never a user choice — it was the old backend
  // default leaking into storage. Treat it as absent so "week" applies.
  if (
    start &&
    end &&
    formatCalendarDateValue(start) === formatCalendarDateValue(end)
  ) {
    return null;
  }

  return { start, end };
}

export function resolveInitialProductAdvertisingDateRange(input: {
  persistedStartDate: Date | null;
  persistedEndDate: Date | null;
  hasExplicitDateRangeInUrl: boolean;
  isInDetailMode?: boolean;
}): AdvertisingDateRange {
  // If the user previously selected a range (persisted in sessionStorage or URL)
  // → keep it so a page refresh preserves their choice.
  // Otherwise → always default to "Неделя" (7 days).
  return (
    normalizeExplicitDateRange({
      persistedStartDate: input.persistedStartDate,
      persistedEndDate: input.persistedEndDate,
    }) ?? getDefaultDateRange()
  );
}

export function resolveProductAdvertisingDateRangeForProductOpen(
  currentRange: AdvertisingDateRange | null | undefined,
) {
  // If the user already has a date range selected (either from a previous
  // product or from sessionStorage) → keep it.
  // Otherwise → default to "Неделя" (7 days ending today).
  if (!currentRange || (!currentRange.start && !currentRange.end)) {
    return getDefaultDateRange();
  }
  return currentRange;
}
