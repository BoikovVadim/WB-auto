import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  SyncEntity,
  WbExportResponse,
} from "../../api/syncClient";
import { buildAppPath } from "../../runtimePaths";
import type {
  ActiveSheet,
  DashboardSection,
  PersistedProductsSortKey,
  ProductsMode,
} from "./persistence/dashboardViewState";
import {
  restoreWindowScrollPosition,
  writeDashboardViewState,
  writePersistedCurrentExportSnapshot,
} from "./persistence/dashboardViewState";
import { readNavEntryFromUrl } from "./persistence/dashboardViewUrl";

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
  // ── Sheet / overlay state ─────────────────────────────────────────────────
  activeSheet: ActiveSheet;
  // ── Products table view state ─────────────────────────────────────────────
  productsSearch: string;
  productsSortKey: PersistedProductsSortKey;
  productsSortDirection: "asc" | "desc";
  // ── Setters used by the browser back / forward (popstate) handler ─────────
  setActiveSection: (value: DashboardSection) => void;
  setActiveSheet: (value: ActiveSheet) => void;
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
    activeSheet,
    productsSearch,
    productsSortKey,
    productsSortDirection,
    setActiveSection,
    setActiveSheet,
  } = input;
  const pendingScrollRestoreRef = useRef<number | null>(initialScrollY);
  const [isMethodTablesReady, setIsMethodTablesReady] = useState(false);
  const previousNavEntryRef = useRef<{ section: DashboardSection; sheet: ActiveSheet }>({
    section: activeSection,
    sheet: activeSheet,
  });

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

  // Browser back / forward: read the new URL and sync React state.
  // The effect-driven URL writer would otherwise replay our previous push
  // and undo the navigation; previousNavEntryRef is updated here so the
  // writer sees the new section as "current" and emits a `replace` rather
  // than a redundant `push`.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const entry = readNavEntryFromUrl();
      if (!entry) return;
      previousNavEntryRef.current = { section: entry.activeSection, sheet: entry.activeSheet };
      setActiveSection(entry.activeSection);
      setActiveSheet(entry.activeSheet);
    };

    window.addEventListener("popstate", handlePopState);
    return () => { window.removeEventListener("popstate", handlePopState); };
  }, [setActiveSection, setActiveSheet]);

  useEffect(() => {
    if (!enablePersistence) {
      return;
    }

    // Use `push` only when the user navigates between sections / sheets so
    // that the browser back/forward buttons step through the navigation
    // history. Other writes (search/sort/filter changes) replace the current
    // entry to keep the back stack clean.
    const prev = previousNavEntryRef.current;
    const isNavigation = prev.section !== activeSection || prev.sheet !== activeSheet;
    previousNavEntryRef.current = { section: activeSection, sheet: activeSheet };

    writeDashboardViewState(
      {
        activeSection,
        productsMode,
        selectedMethodEntity,
        selectedExportId,
        selectedProductNmId,
        selectedCatalogVendorCode,
        productAdvertisingStartDate: persistedAdvertisingStartDate,
        productAdvertisingEndDate: persistedAdvertisingEndDate,
        activeSheet,
        productsSearch,
        productsSortKey,
        productsSortDirection,
      },
      { urlMode: isNavigation ? "push" : "replace" },
    );
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
    activeSheet,
    productsSearch,
    productsSortKey,
    productsSortDirection,
  ]);

  useEffect(() => {
    if (!enablePersistence || activeSection === "products") {
      return;
    }

    writePersistedCurrentExportSnapshot(selectedExportId, currentExport);
  }, [activeSection, currentExport, enablePersistence, selectedExportId]);

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
