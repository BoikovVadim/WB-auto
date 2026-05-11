import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getCachedProductAdvertisingSheet,
  materializeProductAdvertisingSheets,
  readPreparedPresetSheetsForProductAsync,
} from "../../../api/syncClient";
import type { PreparedProductAdvertisingSheetMap } from "../../../api/productSnapshotCache";
import {
  buildAllPreparedRequestInputs,
  buildInitialPreparedSheets,
  buildPreparedRequestSignature,
  hasActiveUsablePreparedSheet,
  mergePreparedSheets,
  scheduleWarmPreparedSheetFetch,
  type UsePreparedProductAdvertisingSheetsInput,
} from "./preparedProductAdvertisingSheets";

export function usePreparedProductAdvertisingSheets(
  input: UsePreparedProductAdvertisingSheetsInput,
) {
  const {
    active,
    nmId,
    warmRequestInputs,
    warmRequestKeys,
    activeRequestInput,
    activeRequestKey,
  } = input;
  const requestSignature = useMemo(
    () => buildPreparedRequestSignature(activeRequestKey, warmRequestKeys),
    [activeRequestKey, warmRequestKeys],
  );
  const allPreparedRequestInputs = useMemo(
    () => buildAllPreparedRequestInputs(activeRequestInput, warmRequestInputs),
    [activeRequestInput, warmRequestInputs],
  );
  const initialPreparedSheets = useMemo(
    () => buildInitialPreparedSheets(input, allPreparedRequestInputs),
    [allPreparedRequestInputs, input],
  );
  const [preparedSheets, setPreparedSheets] =
    useState<PreparedProductAdvertisingSheetMap>(initialPreparedSheets);
  const requestedKeysRef = useRef<Set<string>>(new Set());
  const materializedKeysRef = useRef<Set<string>>(new Set());

  const mergeIntoPreparedSheets = useCallback(
    (nextValue: PreparedProductAdvertisingSheetMap) => {
      setPreparedSheets((currentValue) => mergePreparedSheets(currentValue, nextValue));
    },
    [],
  );

  useEffect(() => {
    if (!active || nmId === null) {
      setPreparedSheets({});
      return;
    }

    setPreparedSheets(initialPreparedSheets);
  }, [active, initialPreparedSheets, nmId, requestSignature]);

  useEffect(() => {
    if (!active || nmId === null || allPreparedRequestInputs.length === 0) {
      return;
    }

    let isCancelled = false;

    void readPreparedPresetSheetsForProductAsync(nmId, allPreparedRequestInputs).then(
      (nextPreparedSheets) => {
        if (isCancelled) {
          return;
        }

        mergeIntoPreparedSheets(nextPreparedSheets);
      },
    );

    if (
      !hasActiveUsablePreparedSheet(input, initialPreparedSheets) ||
      warmRequestInputs.length === 0
    ) {
      return () => {
        isCancelled = true;
      };
    }

    const clearWarmupTimeout = scheduleWarmPreparedSheetFetch({
      nmId,
      warmRequestInputs,
      initialPreparedSheets,
      requestedKeys: requestedKeysRef.current,
      mergeIntoPreparedSheets,
      isCancelled: () => isCancelled,
    });

    return () => {
      isCancelled = true;
      clearWarmupTimeout();
    };
  }, [
    active,
    allPreparedRequestInputs,
    initialPreparedSheets,
    input,
    mergeIntoPreparedSheets,
    nmId,
    requestSignature,
    warmRequestInputs,
  ]);

  useEffect(() => {
    if (
      !active ||
      nmId === null ||
      !activeRequestInput ||
      !activeRequestKey ||
      initialPreparedSheets[activeRequestKey] ||
      getCachedProductAdvertisingSheet(nmId, activeRequestInput)
    ) {
      return;
    }

    if (materializedKeysRef.current.has(activeRequestKey)) {
      return;
    }

    materializedKeysRef.current.add(activeRequestKey);
    void materializeProductAdvertisingSheets({
      nmIds: [nmId],
      reason: "product-detail-direct-open",
      exportRequestId: activeRequestInput.exportRequestId,
      startDate: activeRequestInput.startDate,
      endDate: activeRequestInput.endDate,
      priority: "visible",
    }).catch(() => {
      materializedKeysRef.current.delete(activeRequestKey);
    });
  }, [
    active,
    activeRequestInput,
    activeRequestKey,
    initialPreparedSheets,
    nmId,
  ]);

  const activeBootstrapSheet =
    activeRequestKey !== null ? preparedSheets[activeRequestKey] ?? null : null;

  return {
    preparedProductAdvertisingSheets: preparedSheets,
    activeProductAdvertisingBootstrapSheet: activeBootstrapSheet,
  };
}
