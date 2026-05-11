import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  materializeProductAdvertisingSheets,
  type ProductSnapshotReadinessItem,
} from "../../api/syncClient";
import {
  buildProductsSnapshotStorageKey,
  readPersistedProductsWarmupState,
  writePersistedProductsWarmupState,
} from "./persistence/productsSnapshotWarmupState";

type WarmupStateSnapshot = {
  visibleQueued: boolean;
  backgroundQueued: boolean;
  candidateNmIds: number[];
  updatedAt: string | null;
};

function createEmptyWarmupState(): WarmupStateSnapshot {
  return {
    visibleQueued: false,
    backgroundQueued: false,
    candidateNmIds: [],
    updatedAt: null,
  };
}

const backgroundWarmupDelayMs = 4_000;

export function useProductsSnapshotWarmup(input: {
  active: boolean;
  requestInput: {
    startDate: string;
    endDate: string;
    exportRequestId?: string;
  } | null;
  visibleNmIds: number[];
  backgroundNmIds: number[];
  readinessByNmId?: Record<number, ProductSnapshotReadinessItem>;
  onError?: (message: string) => void;
}) {
  const { active, requestInput, visibleNmIds, backgroundNmIds, readinessByNmId, onError } = input;
  const warmedKeysRef = useRef<Set<string>>(new Set());
  const warmupStateRef = useRef(createEmptyWarmupState());
  const persistTimeoutRef = useRef<number | null>(null);
  const storageKey = useMemo(() => {
    if (!requestInput) {
      return null;
    }

    return buildProductsSnapshotStorageKey({
      exportRequestId: requestInput.exportRequestId,
      startDate: requestInput.startDate,
      endDate: requestInput.endDate,
    });
  }, [requestInput]);
  useEffect(() => {
    warmedKeysRef.current.clear();
    if (persistTimeoutRef.current !== null) {
      window.clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = null;
    }
    warmupStateRef.current = storageKey
      ? readPersistedProductsWarmupState(storageKey)
      : createEmptyWarmupState();
  }, [storageKey]);

  const schedulePersistWarmupState = useCallback(
    (patch: Parameters<typeof writePersistedProductsWarmupState>[1]) => {
      if (!storageKey) {
        return;
      }

      warmupStateRef.current = {
        ...warmupStateRef.current,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
      }
      persistTimeoutRef.current = window.setTimeout(() => {
        writePersistedProductsWarmupState(storageKey, warmupStateRef.current);
        persistTimeoutRef.current = null;
      }, 160);
    },
    [storageKey],
  );

  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
      }
    };
  }, []);

  const queueWarmup = useCallback(
    (nmIds: number[], priority: "visible" | "candidate" | "background", markerKey: string) => {
      if (!requestInput) {
        return;
      }

      const filteredNmIds = Array.from(
        new Set(
          nmIds.filter((nmId) => {
            const readiness = readinessByNmId?.[nmId];
            return !(
              readiness &&
              (readiness.status === "ready" ||
                readiness.status === "stale_ready" ||
                readiness.status === "queued" ||
                readiness.status === "running")
            );
          }),
        ),
      );
      if (filteredNmIds.length === 0) {
        return;
      }

      const warmupKey = `${markerKey}:${filteredNmIds.join(",")}`;
      if (warmedKeysRef.current.has(warmupKey)) {
        return;
      }

      warmedKeysRef.current.add(warmupKey);
      void materializeProductAdvertisingSheets({
        nmIds: filteredNmIds,
        reason: `products-${priority}-prefetch`,
        exportRequestId: requestInput.exportRequestId,
        startDate: requestInput.startDate,
        endDate: requestInput.endDate,
        priority,
      }).catch((error) => {
        warmedKeysRef.current.delete(warmupKey);
        if (!onError) {
          return;
        }

        onError(
          error instanceof Error
            ? error.message
            : "Unable to queue product snapshot materialization.",
        );
      });
    },
    [onError, readinessByNmId, requestInput],
  );

  useEffect(() => {
    if (!active || !storageKey) {
      return;
    }

    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    if (!warmupStateRef.current.visibleQueued && visibleNmIds.length > 0) {
      queueWarmup(visibleNmIds, "visible", `${storageKey}:visible`);
      schedulePersistWarmupState({
        visibleQueued: true,
      });
    }
  }, [active, queueWarmup, schedulePersistWarmupState, storageKey, visibleNmIds]);

  useEffect(() => {
    if (!active || !storageKey) {
      return;
    }

    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    if (warmupStateRef.current.backgroundQueued || backgroundNmIds.length === 0) {
      return;
    }

    const hasVisiblePendingReadiness = visibleNmIds.some((nmId) => {
      const readiness = readinessByNmId?.[nmId];
      return readiness?.status === "queued" || readiness?.status === "running";
    });
    if (hasVisiblePendingReadiness) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      queueWarmup(backgroundNmIds, "background", `${storageKey}:background`);
      schedulePersistWarmupState({
        backgroundQueued: true,
      });
    }, backgroundWarmupDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    active,
    backgroundNmIds,
    queueWarmup,
    readinessByNmId,
    schedulePersistWarmupState,
    storageKey,
    visibleNmIds,
  ]);

  const queueCandidateWarmup = useCallback(
    (nmId: number | null) => {
      if (!storageKey || nmId === null || nmId <= 0) {
        return;
      }

      if (warmupStateRef.current.candidateNmIds.includes(nmId)) {
        return;
      }

      queueWarmup([nmId], "candidate", `${storageKey}:candidate:${String(nmId)}`);
      const nextCandidateNmIds = [...warmupStateRef.current.candidateNmIds, nmId];
      schedulePersistWarmupState({
        candidateNmIds: nextCandidateNmIds,
      });
    },
    [queueWarmup, schedulePersistWarmupState, storageKey],
  );

  return {
    queueCandidateWarmup,
  };
}
