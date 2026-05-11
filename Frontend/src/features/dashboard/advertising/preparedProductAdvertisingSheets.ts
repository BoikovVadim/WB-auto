import { buildProductAdvertisingSheetRequestKey } from "../../../api/productAdvertisingSheetIdentity";
import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import {
  fetchProductAdvertisingSheet,
  getCachedProductAdvertisingSheet,
  readPreparedPresetSheetsForProduct,
  type ProductAdvertisingSheetResponse,
} from "../../../api/syncClient";
import type { PreparedProductAdvertisingSheetMap } from "../../../api/productSnapshotCache";

import { mergeProductAdvertisingSheetSnapshots } from "./snapshot";

export interface UsePreparedProductAdvertisingSheetsInput {
  active: boolean;
  nmId: number | null;
  warmRequestInputs: ProductAdvertisingSheetRequestInput[];
  warmRequestKeys: string[];
  activeRequestInput: ProductAdvertisingSheetRequestInput | null;
  activeRequestKey: string | null;
  initialProductAdvertisingSheet: ProductAdvertisingSheetResponse | null;
}

const warmPresetFetchConcurrency = 2;
const warmPresetFetchDelayMs = 1_200;

export function buildPreparedRequestSignature(
  activeRequestKey: string | null,
  warmRequestKeys: string[],
) {
  return [activeRequestKey ?? "none", ...warmRequestKeys].filter(Boolean).join("|");
}

export function buildAllPreparedRequestInputs(
  activeRequestInput: ProductAdvertisingSheetRequestInput | null,
  warmRequestInputs: ProductAdvertisingSheetRequestInput[],
) {
  if (!activeRequestInput) {
    return warmRequestInputs;
  }

  const requestInputs = [activeRequestInput];
  for (const requestInput of warmRequestInputs) {
    if (
      requestInput.startDate === activeRequestInput.startDate &&
      requestInput.endDate === activeRequestInput.endDate &&
      requestInput.exportRequestId === activeRequestInput.exportRequestId
    ) {
      continue;
    }

    requestInputs.push(requestInput);
  }

  return requestInputs;
}

export function mergePreparedSheets(
  currentValue: PreparedProductAdvertisingSheetMap,
  nextValue: PreparedProductAdvertisingSheetMap,
) {
  let hasChanges = false;
  const mergedValue: PreparedProductAdvertisingSheetMap = { ...currentValue };

  for (const [requestKey, sheet] of Object.entries(nextValue)) {
    const mergedSheet =
      mergeProductAdvertisingSheetSnapshots(currentValue[requestKey] ?? null, sheet) ?? sheet;
    if (mergedSheet !== currentValue[requestKey]) {
      mergedValue[requestKey] = mergedSheet;
      hasChanges = true;
    }
  }

  return hasChanges ? mergedValue : currentValue;
}

export function buildInitialPreparedSheets(
  input: UsePreparedProductAdvertisingSheetsInput,
  allPreparedRequestInputs: ProductAdvertisingSheetRequestInput[],
) {
  if (!input.active || input.nmId === null) {
    return {};
  }

  const preparedSheets = readPreparedPresetSheetsForProduct(input.nmId, allPreparedRequestInputs);
  if (
    input.initialProductAdvertisingSheet &&
    input.activeRequestKey &&
    input.activeRequestInput &&
    input.initialProductAdvertisingSheet.nmId === input.nmId &&
    input.initialProductAdvertisingSheet.range.startDate === input.activeRequestInput.startDate &&
    input.initialProductAdvertisingSheet.range.endDate === input.activeRequestInput.endDate
  ) {
    preparedSheets[input.activeRequestKey] =
      mergeProductAdvertisingSheetSnapshots(
        preparedSheets[input.activeRequestKey] ?? null,
        input.initialProductAdvertisingSheet,
      ) ?? input.initialProductAdvertisingSheet;
  }

  return preparedSheets;
}

export function hasActiveUsablePreparedSheet(
  input: UsePreparedProductAdvertisingSheetsInput,
  initialPreparedSheets: PreparedProductAdvertisingSheetMap,
) {
  if (input.nmId === null) {
    return false;
  }

  return Boolean(
    input.activeRequestKey &&
      input.activeRequestInput &&
      (initialPreparedSheets[input.activeRequestKey] ||
        getCachedProductAdvertisingSheet(input.nmId, input.activeRequestInput)),
  );
}

interface ScheduleWarmPreparedSheetFetchInput {
  nmId: number;
  warmRequestInputs: ProductAdvertisingSheetRequestInput[];
  initialPreparedSheets: PreparedProductAdvertisingSheetMap;
  requestedKeys: Set<string>;
  mergeIntoPreparedSheets: (nextValue: PreparedProductAdvertisingSheetMap) => void;
  isCancelled: () => boolean;
}

export function scheduleWarmPreparedSheetFetch(
  input: ScheduleWarmPreparedSheetFetchInput,
) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const runWarmupFetch = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    void (async () => {
      for (
        let index = 0;
        index < input.warmRequestInputs.length;
        index += warmPresetFetchConcurrency
      ) {
        if (input.isCancelled()) {
          return;
        }

        const warmupChunk = input.warmRequestInputs.slice(
          index,
          index + warmPresetFetchConcurrency,
        );
        await Promise.all(
          warmupChunk.map(async (requestInput) => {
            const requestKey = buildProductAdvertisingSheetRequestKey(input.nmId, requestInput);
            if (
              input.initialPreparedSheets[requestKey] ||
              input.requestedKeys.has(requestKey) ||
              getCachedProductAdvertisingSheet(input.nmId, requestInput)
            ) {
              return;
            }

            input.requestedKeys.add(requestKey);
            try {
              const sheet = await fetchProductAdvertisingSheet(input.nmId, requestInput);
              if (input.isCancelled()) {
                return;
              }

              input.mergeIntoPreparedSheets({
                [requestKey]: sheet,
              });
            } catch {
              input.requestedKeys.delete(requestKey);
            }
          }),
        );
      }
    })();
  };

  const warmupTimeoutId = window.setTimeout(() => {
    if ("requestIdleCallback" in window) {
      const requestIdleCallback = window.requestIdleCallback.bind(window) as (
        callback: IdleRequestCallback,
      ) => number;
      requestIdleCallback(() => {
        runWarmupFetch();
      });
      return;
    }

    runWarmupFetch();
  }, warmPresetFetchDelayMs);

  return () => {
    window.clearTimeout(warmupTimeoutId);
  };
}
