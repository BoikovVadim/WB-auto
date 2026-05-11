import { startTransition, useCallback, useEffect, useState } from "react";

import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import { buildProductAdvertisingSheetRequestKey } from "../../../api/productAdvertisingSheetIdentity";
import {
  fetchProductAdvertisingSheet,
  getCachedProductAdvertisingSheet,
  getCachedProductAdvertisingSheetAsync,
  type ProductAdvertisingSheetResponse,
} from "../../../api/syncClient";
import { normalizeProductAdvertisingQueryError } from "./productAdvertisingQueryError";
import { mergeProductAdvertisingSheetSnapshots } from "./snapshot";

const sheetRefreshTtlMs = 60_000;
const fallbackSheetRefreshTtlMs = 5 * 60_000;

interface ProductAdvertisingSheetQueryInput {
  active: boolean;
  nmId: number | null;
  requestInput: ProductAdvertisingSheetRequestInput | null;
  initialSheet?: ProductAdvertisingSheetResponse | null;
  bootstrapSheet?: ProductAdvertisingSheetResponse | null;
  refreshKey?: number;
  networkMode?: "cache-only" | "cache-and-network";
}

export type ProductAdvertisingSheetQueryStatus =
  | "idle"
  | "bootstrapping"
  | "ready"
  | "error"
  | "stale-ready"
  | "confirmed-empty";

function shouldBackgroundRefreshSheet(value: ProductAdvertisingSheetResponse | null) {
  if (!value) {
    return true;
  }

  if (value.snapshot.status !== "ready") {
    return true;
  }

  const checkedAtMs = Date.parse(value.checkedAt);
  if (!Number.isFinite(checkedAtMs)) {
    return true;
  }

  if (value.snapshot.fit !== "exact") {
    return Date.now() - checkedAtMs > fallbackSheetRefreshTtlMs;
  }

  if (
    value.range.jamStatus === "pending" ||
    value.summary.periodMetricsStatus !== "exact"
  ) {
    return true;
  }

  return Date.now() - checkedAtMs > sheetRefreshTtlMs;
}

export function useProductAdvertisingSheetQuery(input: ProductAdvertisingSheetQueryInput) {
  const { active, nmId, requestInput, initialSheet, bootstrapSheet, refreshKey, networkMode } = input;
  const [sheet, setSheet] = useState<ProductAdvertisingSheetResponse | null>(
    bootstrapSheet ?? initialSheet ?? null,
  );
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestKey =
    active && nmId !== null && requestInput
      ? buildProductAdvertisingSheetRequestKey(nmId, requestInput)
      : null;

  useEffect(() => {
    if (!bootstrapSheet) {
      return;
    }

    setSheet((currentValue) =>
      mergeProductAdvertisingSheetSnapshots(currentValue, bootstrapSheet ?? null),
    );
  }, [bootstrapSheet]);

  const matchesRequestedRange = useCallback(
    (value: ProductAdvertisingSheetResponse | null) => {
      if (!value || !requestInput) {
        return false;
      }

      return (
        value.range.startDate === requestInput.startDate &&
        value.range.endDate === requestInput.endDate
      );
    },
    [requestInput],
  );

  const runFetch = useCallback(
    async (options?: { background?: boolean; hasUsableSheet?: boolean }) => {
      if (
        !active ||
        nmId === null ||
        !requestInput ||
        networkMode === "cache-only"
      ) {
        return null;
      }

      setIsBootstrapping(!options?.hasUsableSheet);
      try {
        const response = await fetchProductAdvertisingSheet(nmId, requestInput);
        setError(null);
        if (options?.background || options?.hasUsableSheet) {
          startTransition(() => {
            setSheet((currentValue) => mergeProductAdvertisingSheetSnapshots(currentValue, response));
          });
        } else {
          setSheet((currentValue) => mergeProductAdvertisingSheetSnapshots(currentValue, response));
        }
        setIsBootstrapping(false);
        return response;
      } catch (requestError) {
        setError(normalizeProductAdvertisingQueryError(requestError));
        setIsBootstrapping(false);
        throw requestError;
      }
    },
    [active, networkMode, nmId, requestInput],
  );
  const shouldFetchFromNetwork = networkMode !== "cache-only";

  useEffect(() => {
    if (!active || nmId === null || !requestInput) {
      setSheet(null);
      setIsBootstrapping(false);
      setError(null);
      return;
    }

    let isCancelled = false;
    const cachedSheet = getCachedProductAdvertisingSheet(nmId, requestInput);
    const immediateSheet = cachedSheet ?? bootstrapSheet ?? null;

    setSheet((currentValue) => {
      const nextCurrentValue =
        currentValue?.nmId === nmId && matchesRequestedRange(currentValue)
          ? currentValue
          : null;
      return immediateSheet
        ? mergeProductAdvertisingSheetSnapshots(nextCurrentValue, immediateSheet)
        : nextCurrentValue;
    });

    const hasUsableImmediateSheet = Boolean(immediateSheet);
    if (hasUsableImmediateSheet) {
      setError(null);
      if (shouldFetchFromNetwork && shouldBackgroundRefreshSheet(immediateSheet)) {
        void runFetch({
          background: true,
          hasUsableSheet: true,
        }).catch(() => null);
      } else {
        setIsBootstrapping(false);
      }
    } else {
      setIsBootstrapping(true);
      void getCachedProductAdvertisingSheetAsync(nmId, requestInput).then(
        (storedSheet) => {
          if (isCancelled) {
            return;
          }

          if (storedSheet) {
            setError(null);
            setSheet((currentValue) =>
              mergeProductAdvertisingSheetSnapshots(currentValue, storedSheet),
            );
            if (!shouldBackgroundRefreshSheet(storedSheet)) {
              setIsBootstrapping(false);
              return;
            }
          }

          if (!shouldFetchFromNetwork) {
            setIsBootstrapping(false);
            return;
          }

          void runFetch({
            background: true,
            hasUsableSheet: Boolean(storedSheet),
          }).catch(() => null);
        },
      );
    }

    return () => {
      isCancelled = true;
    };
  }, [
    active,
    bootstrapSheet,
    matchesRequestedRange,
    nmId,
    requestKey,
    refreshKey,
    requestInput,
    runFetch,
    shouldFetchFromNetwork,
  ]);

  const isConfirmedEmpty =
    sheet?.snapshot.status === "missing" &&
    (sheet.summary.campaignsCount ?? 0) === 0 &&
    (sheet.summary.clustersCount ?? 0) === 0 &&
    (sheet.summary.clusterQueriesCount ?? 0) === 0 &&
    (sheet.summary.dailyStatsCount ?? 0) === 0;

  const status: ProductAdvertisingSheetQueryStatus = error
    ? sheet
      ? "stale-ready"
      : "error"
    : isBootstrapping
      ? sheet
        ? "stale-ready"
        : "bootstrapping"
      : isConfirmedEmpty
        ? "confirmed-empty"
      : sheet
        ? "ready"
        : "idle";

  return {
    productAdvertisingSheet: sheet,
    setProductAdvertisingSheet: setSheet,
    isProductAdvertisingLoading: isBootstrapping,
    productAdvertisingSheetError: error,
    productAdvertisingSheetStatus: status,
    reloadProductAdvertisingSheet: runFetch,
  };
}
