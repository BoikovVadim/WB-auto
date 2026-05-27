import { getAdvertisingDatePresetRange, type AdvertisingDateRange } from "./date";

// Default preset applied when no explicit date range is available.
// Used both on the first app load and when entering a product without
// a stored preference.
function getDefaultDateRange(): AdvertisingDateRange {
  return getAdvertisingDatePresetRange("month");
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
  _currentRange: AdvertisingDateRange | null | undefined,
) {
  // Product open should always start from a sliding month window ending today.
  return getDefaultDateRange();
}
