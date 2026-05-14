import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  SyncEntity,
  WbExportResponse,
} from "../../api/syncClient";
import { buildAppPath } from "../../runtimePaths";
import type {
  DashboardSection,
  ProductsMode,
} from "./persistence/dashboardViewState";
import {
  restoreWindowScrollPosition,
  writeDashboardViewState,
  writePersistedCurrentExportSnapshot,
} from "./persistence/dashboardViewState";

export function useDashboardBrowserEffects(input: {
  enablePersistence: boolean;
  initialScrollY: number | null;
  activeSection: DashboardSection;
  productsMode: ProductsMode;
  selectedMethodEntity: SyncEntity | null;
  selectedExportId: string | null;
  selectedProductNmId: number | null;
  selectedCatalogVendorCode: string | null;
  persistedAdvertisingStartDate: string | null;
  persistedAdvertisingEndDate: string | null;
  currentExport: WbExportResponse | null;
  exportHistoryLength: number;
}) {
  const {
    enablePersistence,
    initialScrollY,
    activeSection,
    productsMode,
    selectedMethodEntity,
    selectedExportId,
    selectedProductNmId,
    selectedCatalogVendorCode,
    persistedAdvertisingStartDate,
    persistedAdvertisingEndDate,
    currentExport,
    exportHistoryLength,
  } = input;
  const pendingScrollRestoreRef = useRef<number | null>(initialScrollY);
  const [isMethodTablesReady, setIsMethodTablesReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let isCancelled = false;
    const currentBundlePath = getCurrentFrontendBundlePath();
    if (!currentBundlePath) {
      return;
    }

    const checkForNewFrontendBundle = async () => {
      try {
        const latestBundlePath = await fetchLatestFrontendBundlePath();
        if (
          !isCancelled &&
          latestBundlePath &&
          latestBundlePath !== currentBundlePath
        ) {
          window.location.reload();
        }
      } catch {
        return;
      }
    };

    const intervalId = window.setInterval(checkForNewFrontendBundle, 5_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForNewFrontendBundle();
      }
    };

    void checkForNewFrontendBundle();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const previousValue = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previousValue;
    };
  }, []);

  useEffect(() => {
    if (!enablePersistence) {
      return;
    }

    writeDashboardViewState({
      activeSection,
      productsMode,
      selectedMethodEntity,
      selectedExportId,
      selectedProductNmId,
      selectedCatalogVendorCode,
      productAdvertisingStartDate: persistedAdvertisingStartDate,
      productAdvertisingEndDate: persistedAdvertisingEndDate,
    });
  }, [
    activeSection,
    persistedAdvertisingEndDate,
    persistedAdvertisingStartDate,
    productsMode,
    selectedCatalogVendorCode,
    selectedExportId,
    selectedMethodEntity,
    selectedProductNmId,
    enablePersistence,
  ]);

  useEffect(() => {
    if (!enablePersistence) {
      return;
    }

    writePersistedCurrentExportSnapshot(selectedExportId, currentExport);
  }, [currentExport, enablePersistence, selectedExportId]);

  useEffect(() => {
    if (activeSection !== "method" || !currentExport) {
      setIsMethodTablesReady(false);
      return;
    }

    if (typeof window === "undefined") {
      setIsMethodTablesReady(true);
      return;
    }

    setIsMethodTablesReady(false);
    const timerId = window.setTimeout(() => {
      setIsMethodTablesReady(true);
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [activeSection, currentExport]);

  useEffect(() => {
    if (!enablePersistence) {
      return;
    }

    const handleScroll = () => {
      writeDashboardViewState({
        scrollY: window.scrollY,
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [enablePersistence]);

  useEffect(() => {
    if (!enablePersistence) {
      return;
    }

    const persistScrollPosition = () => {
      writeDashboardViewState({
        scrollY: window.scrollY,
      });
    };

    window.addEventListener("beforeunload", persistScrollPosition);
    window.addEventListener("pagehide", persistScrollPosition);

    return () => {
      window.removeEventListener("beforeunload", persistScrollPosition);
      window.removeEventListener("pagehide", persistScrollPosition);
    };
  }, [enablePersistence]);

  useLayoutEffect(() => {
    if (pendingScrollRestoreRef.current === null) {
      return;
    }

    if (selectedMethodEntity !== null && selectedExportId !== null && !currentExport) {
      return;
    }

    const targetScrollY = pendingScrollRestoreRef.current;
    const cleanup = restoreWindowScrollPosition(targetScrollY);
    pendingScrollRestoreRef.current = null;
    return cleanup;
  }, [
    activeSection,
    currentExport,
    exportHistoryLength,
    productsMode,
    selectedCatalogVendorCode,
    selectedExportId,
    selectedMethodEntity,
    selectedProductNmId,
  ]);

  return {
    isMethodTablesReady,
  };
}

function getCurrentFrontendBundlePath() {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return null;
  }

  const scriptElement = document.querySelector<HTMLScriptElement>(
    'script[type="module"][src*="/assets/index-"]',
  );
  if (!scriptElement?.src) {
    return null;
  }

  try {
    return new URL(scriptElement.src, window.location.origin).pathname;
  } catch {
    return null;
  }
}

async function fetchLatestFrontendBundlePath() {
  if (typeof window === "undefined") {
    return null;
  }

  const response = await fetch(buildAppPath("index.html"), {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
    },
  });
  const html = await response.text();
  const match = html.match(/<script type="module" crossorigin src="([^"]+)"/i);
  if (!match?.[1]) {
    return null;
  }

  try {
    return new URL(match[1], window.location.origin).pathname;
  } catch {
    return null;
  }
}
