import { useEffect, useRef } from "react";

const visiblePendingSyncPollIntervalMs = 6_000;
const hiddenPendingSyncPollIntervalMs = 15_000;

export function useProductAdvertisingPendingSyncPolling(input: {
  active: boolean;
  hasPendingSync: boolean;
  onRefresh: () => void;
}) {
  const onRefreshRef = useRef(input.onRefresh);

  useEffect(() => {
    onRefreshRef.current = input.onRefresh;
  }, [input.onRefresh]);

  useEffect(() => {
    if (!input.active || !input.hasPendingSync) {
      return;
    }

    let timeoutId: number | null = null;
    let isCancelled = false;

    const scheduleNextPoll = () => {
      const pollIntervalMs =
        typeof document !== "undefined" && document.visibilityState === "hidden"
          ? hiddenPendingSyncPollIntervalMs
          : visiblePendingSyncPollIntervalMs;
      timeoutId = window.setTimeout(() => {
        if (isCancelled) {
          return;
        }

        onRefreshRef.current();
        scheduleNextPoll();
      }, pollIntervalMs);
    };

    scheduleNextPoll();

    return () => {
      isCancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [input.active, input.hasPendingSync]);
}
