import { useCallback, useEffect, useRef, useState } from "react";

export function useAdvertisingClusterCopyFeedback() {
  const [copiedClusterKey, setCopiedClusterKey] = useState<string | null>(null);
  const copiedClusterResetTimeoutRef = useRef<number | null>(null);
  const [copiedQueryKey, setCopiedQueryKey] = useState<string | null>(null);
  const copiedQueryResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedClusterResetTimeoutRef.current !== null) {
        window.clearTimeout(copiedClusterResetTimeoutRef.current);
      }
      if (copiedQueryResetTimeoutRef.current !== null) {
        window.clearTimeout(copiedQueryResetTimeoutRef.current);
      }
    };
  }, []);

  const copyClusterName = useCallback(async (clusterKey: string, clusterName: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(clusterName);
      setCopiedClusterKey(clusterKey);
      if (copiedClusterResetTimeoutRef.current !== null) {
        window.clearTimeout(copiedClusterResetTimeoutRef.current);
      }
      copiedClusterResetTimeoutRef.current = window.setTimeout(() => {
        setCopiedClusterKey((currentValue) =>
          currentValue === clusterKey ? null : currentValue,
        );
        copiedClusterResetTimeoutRef.current = null;
      }, 1200);
    } catch {
      return;
    }
  }, []);

  const copyQueryText = useCallback(async (queryKey: string, queryText: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(queryText);
      setCopiedQueryKey(queryKey);
      if (copiedQueryResetTimeoutRef.current !== null) {
        window.clearTimeout(copiedQueryResetTimeoutRef.current);
      }
      copiedQueryResetTimeoutRef.current = window.setTimeout(() => {
        setCopiedQueryKey((currentValue) =>
          currentValue === queryKey ? null : currentValue,
        );
        copiedQueryResetTimeoutRef.current = null;
      }, 1200);
    } catch {
      return;
    }
  }, []);

  return {
    copiedClusterKey,
    onCopyClusterName: copyClusterName,
    copiedQueryKey,
    onCopyQueryText: copyQueryText,
  };
}
