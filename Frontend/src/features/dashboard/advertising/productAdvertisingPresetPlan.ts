import { buildProductAdvertisingSheetRequestKey } from "../../../api/productAdvertisingSheetIdentity";
import type {
  ProductAdvertisingSheetResponse,
  WbExportResponse,
} from "../../../api/syncClient";
import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import type { AdvertisingDatePreset, AdvertisingDateRange } from "./date";
import { getAdvertisingDatePresetRange } from "./date";
import { resolveProductAdvertisingSheetRequestInput } from "./useProductAdvertisingRequestInput";

export type ProductAdvertisingPresetKey = AdvertisingDatePreset;

export interface PlannedProductAdvertisingPreset {
  presetKey: ProductAdvertisingPresetKey;
  dateRange: AdvertisingDateRange;
  requestInput: ProductAdvertisingSheetRequestInput;
  requestKey: string;
}

interface ProductAdvertisingPresetPlanInput {
  currentExport: WbExportResponse | null;
  initialProductAdvertisingSheet: ProductAdvertisingSheetResponse | null;
  productAdvertisingDateRange: AdvertisingDateRange;
  selectedProductNmId: number | null;
}

interface ProductAdvertisingPresetPlan {
  activeRequestInput: ProductAdvertisingSheetRequestInput | null;
  activeRequestKey: string | null;
  presets: PlannedProductAdvertisingPreset[];
  warmRequestInputs: ProductAdvertisingSheetRequestInput[];
  warmRequestKeys: string[];
}

function buildPresetDefinition(
  nmId: number,
  presetKey: ProductAdvertisingPresetKey,
  dateRange: AdvertisingDateRange,
  input: ProductAdvertisingPresetPlanInput,
): PlannedProductAdvertisingPreset {
  const requestInput = resolveProductAdvertisingSheetRequestInput({
    currentExport: input.currentExport,
    initialProductAdvertisingSheet: input.initialProductAdvertisingSheet,
    selectedProductNmId: input.selectedProductNmId,
    productAdvertisingDateRange: dateRange,
  });

  return {
    presetKey,
    dateRange,
    requestInput,
    requestKey: buildProductAdvertisingSheetRequestKey(nmId, requestInput),
  };
}

function appendUniquePreparedRequest(
  preparedRequests: ProductAdvertisingSheetRequestInput[],
  preparedRequestKeys: string[],
  nextRequestInput: ProductAdvertisingSheetRequestInput,
  nextRequestKey: string,
) {
  if (preparedRequestKeys.includes(nextRequestKey)) {
    return;
  }

  preparedRequests.push(nextRequestInput);
  preparedRequestKeys.push(nextRequestKey);
}

export function buildProductAdvertisingPresetPlan(
  input: ProductAdvertisingPresetPlanInput,
): ProductAdvertisingPresetPlan {
  const nmId = input.selectedProductNmId;
  if (nmId === null) {
    return {
      activeRequestInput: null,
      activeRequestKey: null,
      presets: [],
      warmRequestInputs: [],
      warmRequestKeys: [],
    };
  }

  const presets = [
    buildPresetDefinition(
      nmId,
      "today",
      getAdvertisingDatePresetRange("today"),
      input,
    ),
    buildPresetDefinition(
      nmId,
      "yesterday",
      getAdvertisingDatePresetRange("yesterday"),
      input,
    ),
    buildPresetDefinition(
      nmId,
      "week",
      getAdvertisingDatePresetRange("week"),
      input,
    ),
    buildPresetDefinition(
      nmId,
      "month",
      getAdvertisingDatePresetRange("month"),
      input,
    ),
  ];

  const preparedRequestInputs: ProductAdvertisingSheetRequestInput[] = [];
  const preparedRequestKeys: string[] = [];
  for (const preset of presets) {
    appendUniquePreparedRequest(
      preparedRequestInputs,
      preparedRequestKeys,
      preset.requestInput,
      preset.requestKey,
    );
  }

  const activeRequestInput = resolveProductAdvertisingSheetRequestInput({
    currentExport: input.currentExport,
    initialProductAdvertisingSheet: input.initialProductAdvertisingSheet,
    selectedProductNmId: input.selectedProductNmId,
    productAdvertisingDateRange: input.productAdvertisingDateRange,
  });
  const activeRequestKey = buildProductAdvertisingSheetRequestKey(nmId, activeRequestInput);
  appendUniquePreparedRequest(
    preparedRequestInputs,
    preparedRequestKeys,
    activeRequestInput,
    activeRequestKey,
  );

  return {
    activeRequestInput,
    activeRequestKey,
    presets,
    warmRequestInputs: preparedRequestInputs.filter(
      (_, index) => preparedRequestKeys[index] !== activeRequestKey,
    ),
    warmRequestKeys: preparedRequestKeys.filter((requestKey) => requestKey !== activeRequestKey),
  };
}
