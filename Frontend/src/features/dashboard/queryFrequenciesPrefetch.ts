import { fetchRawQueryFrequencies, type RawQueryFrequencyRow } from "../../api/syncClientCore";

/**
 * Module-level cache. startQueryFrequenciesPrefetch() is called once at
 * dashboard bootstrap so the fetch runs in the background immediately.
 *
 * getQueryFrequenciesSync() returns already-loaded rows synchronously —
 * components use this to render without any loading state when the data
 * is ready. getQueryFrequenciesPromise() returns the in-flight promise
 * for the case where the user arrives before the fetch completes.
 */
let prefetchPromise: Promise<RawQueryFrequencyRow[]> | null = null;
let resolvedRows: RawQueryFrequencyRow[] | null = null;

export function startQueryFrequenciesPrefetch(): void {
  if (prefetchPromise) return;
  prefetchPromise = fetchRawQueryFrequencies().then((rows) => {
    resolvedRows = rows;
    return rows;
  });
}

/** Returns already-loaded rows synchronously, or null if still in-flight. */
export function getQueryFrequenciesSync(): RawQueryFrequencyRow[] | null {
  return resolvedRows;
}

export function getQueryFrequenciesPromise(): Promise<RawQueryFrequencyRow[]> {
  if (!prefetchPromise) {
    prefetchPromise = fetchRawQueryFrequencies().then((rows) => {
      resolvedRows = rows;
      return rows;
    });
  }
  return prefetchPromise;
}

export function invalidateQueryFrequenciesPrefetch(): void {
  prefetchPromise = null;
  resolvedRows = null;
}
