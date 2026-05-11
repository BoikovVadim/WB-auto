export interface ProductAdvertisingSheetRequestInput {
  startDate: string;
  endDate: string;
  exportRequestId?: string;
}

function normalizeRequestPart(value: string | undefined) {
  return value?.trim() ?? "";
}

export function normalizeProductAdvertisingSheetRequestInput(
  input?: ProductAdvertisingSheetRequestInput | null,
) {
  if (!input) {
    return {
      startDate: "",
      endDate: "",
    };
  }

  return {
    startDate: normalizeRequestPart(input.startDate),
    endDate: normalizeRequestPart(input.endDate),
  };
}

export function buildProductAdvertisingSheetCacheKey(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput | null,
) {
  const normalizedInput = normalizeProductAdvertisingSheetRequestInput(input);
  return [
    "wb-dashboard-product-advertising-sheet",
    String(nmId),
    normalizedInput.startDate,
    normalizedInput.endDate,
  ].join(":");
}

export function buildProductAdvertisingSheetRequestKey(
  nmId: number,
  input?: ProductAdvertisingSheetRequestInput | null,
) {
  const normalizedInput = normalizeProductAdvertisingSheetRequestInput(input);
  return [String(nmId), normalizedInput.startDate, normalizedInput.endDate].join(":");
}
