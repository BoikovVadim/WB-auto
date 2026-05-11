import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchProductSnapshotReadiness,
  type ProductSnapshotReadinessItem,
} from "../../api/syncClient";
import {
  buildProductsSnapshotStorageKey,
  readPersistedProductsReadiness,
  writePersistedProductsReadiness,
} from "./persistence/productsSnapshotWarmupState";

const readinessChunkSize = 200;
const readinessPollIntervalMs = 8_000;

export function useProductsSnapshotReadiness(input: {
  active: boolean;
  requestInput: {
    startDate: string;
    endDate: string;
    exportRequestId?: string;
  } | null;
  nmIds: number[];
}) {
  const storageKey = useMemo(() => {
    if (!input.requestInput) {
      return null;
    }

    return buildProductsSnapshotStorageKey({
      exportRequestId: input.requestInput.exportRequestId,
      startDate: input.requestInput.startDate,
      endDate: input.requestInput.endDate,
    });
  }, [input.requestInput]);

  const [itemsByNmId, setItemsByNmId] = useState<Record<number, ProductSnapshotReadinessItem>>(() =>
    storageKey ? readPersistedProductsReadiness(storageKey) : {},
  );
  const itemsByNmIdRef = useRef(itemsByNmId);
  const isLoadingRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    itemsByNmIdRef.current = itemsByNmId;
  }, [itemsByNmId]);

  useEffect(() => {
    if (!storageKey) {
      setItemsByNmId({});
      hasLoadedOnceRef.current = false;
      return;
    }

    setItemsByNmId(readPersistedProductsReadiness(storageKey));
    hasLoadedOnceRef.current = false;
  }, [storageKey]);

  useEffect(() => {
    if (!input.active || !input.requestInput) {
      return;
    }

    const nmIds = Array.from(new Set(input.nmIds.filter((value) => Number.isInteger(value) && value > 0)));
    if (nmIds.length === 0 || !storageKey) {
      setItemsByNmId({});
      hasLoadedOnceRef.current = false;
      return;
    }

    const requestInput = input.requestInput;
    let isCancelled = false;

    const loadReadiness = async () => {
      if (isLoadingRef.current) {
        return;
      }

      isLoadingRef.current = true;
      const nextItems: ProductSnapshotReadinessItem[] = [];

      try {
        for (let index = 0; index < nmIds.length; index += readinessChunkSize) {
          const chunk = nmIds.slice(index, index + readinessChunkSize);
          const response = await fetchProductSnapshotReadiness({
            nmIds: chunk,
            exportRequestId: requestInput.exportRequestId,
            startDate: requestInput.startDate,
            endDate: requestInput.endDate,
          });
          nextItems.push(...response.items);
        }

        if (isCancelled) {
          return;
        }

        const record = nextItems.reduce<Record<number, ProductSnapshotReadinessItem>>(
          (accumulator, item) => {
            accumulator[item.nmId] = item;
            return accumulator;
          },
          {},
        );
        hasLoadedOnceRef.current = true;
        setItemsByNmId(record);
        writePersistedProductsReadiness(storageKey, nextItems);
      } finally {
        isLoadingRef.current = false;
      }
    };

    void loadReadiness();

    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      const latestItemsByNmId = itemsByNmIdRef.current;
      const hasPendingItems = Object.values(latestItemsByNmId).some(
        (item) => item.status === "queued" || item.status === "running",
      );
      if (hasPendingItems && hasLoadedOnceRef.current) {
        void loadReadiness();
      }
    }, readinessPollIntervalMs);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [input.active, input.nmIds, input.requestInput, storageKey]);

  return {
    productSnapshotReadinessByNmId: itemsByNmId,
  };
}
