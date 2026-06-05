import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";

import type {
  AdvertisingClusterNumericFilterKey,
  AdvertisingClusterNumericFilters,
  AdvertisingClusterStatusFilter,
  AdvertisingClusterSortDirection,
  AdvertisingClusterSortKey,
  AdvertisingClusterSortableKey,
} from "./advertisingTableTypes";
import {
  createAdvertisingClusterNumericFilters,
  getDefaultAdvertisingSortDirection,
} from "./model";

const SORT_SESSION_KEY = "wb-advertising-sort-state";
const STATUS_FILTER_SESSION_KEY = "wb-advertising-status-filter";

function readStoredStatusFilter(): AdvertisingClusterStatusFilter | null {
  try {
    const raw = window.sessionStorage.getItem(STATUS_FILTER_SESSION_KEY);
    if (raw === "active" || raw === "excluded" || raw === "all") return raw;
  } catch {
    // ignore
  }
  return null;
}

function writeStoredStatusFilter(value: AdvertisingClusterStatusFilter) {
  try {
    window.sessionStorage.setItem(STATUS_FILTER_SESSION_KEY, value);
  } catch {
    // ignore
  }
}

function clearStoredStatusFilter() {
  try {
    window.sessionStorage.removeItem(STATUS_FILTER_SESSION_KEY);
  } catch {
    // ignore
  }
}

function readStoredSortState(): { key: AdvertisingClusterSortableKey; direction: AdvertisingClusterSortDirection } | null {
  try {
    const raw = window.sessionStorage.getItem(SORT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "key" in parsed &&
      "direction" in parsed &&
      typeof (parsed as { key: unknown }).key === "string" &&
      typeof (parsed as { direction: unknown }).direction === "string"
    ) {
      return parsed as { key: AdvertisingClusterSortableKey; direction: AdvertisingClusterSortDirection };
    }
  } catch {
    // ignore malformed storage
  }
  return null;
}

function writeStoredSortState(state: { key: AdvertisingClusterSortableKey; direction: AdvertisingClusterSortDirection }) {
  try {
    window.sessionStorage.setItem(SORT_SESSION_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

function clearStoredSortState() {
  try {
    window.sessionStorage.removeItem(SORT_SESSION_KEY);
  } catch {
    // ignore
  }
}

const DEFAULT_SORT_STATE = { key: "spend" as AdvertisingClusterSortableKey, direction: "desc" as AdvertisingClusterSortDirection };

export function useAdvertisingClusterTableControls(input: {
  productNmId: number | null;
  selectedCampaignAdvertId: number | null;
  tableRefreshKey: number;
}) {
  const [clusterSearch, setClusterSearch] = useState("");
  const [clusterNameSearch, setClusterNameSearch] = useState("");
  const [numericFilters, setNumericFilters] = useState<AdvertisingClusterNumericFilters>(() =>
    createAdvertisingClusterNumericFilters(),
  );
  const [statusFilter, setStatusFilter] =
    useState<AdvertisingClusterStatusFilter>(() => readStoredStatusFilter() ?? "active");

  const setStatusFilterPersisted = useCallback((value: AdvertisingClusterStatusFilter) => {
    writeStoredStatusFilter(value);
    setStatusFilter(value);
  }, []);
  const [sortState, setSortState] = useState<{
    key: AdvertisingClusterSortableKey;
    direction: AdvertisingClusterSortDirection;
  }>(() => readStoredSortState() ?? DEFAULT_SORT_STATE);

  // Track whether the user has been in detail view so we can reset sort on exit
  const wasInDetailRef = useRef(input.selectedCampaignAdvertId !== null);
  useEffect(() => {
    const isNowInDetail = input.selectedCampaignAdvertId !== null;
    if (wasInDetailRef.current && !isNowInDetail) {
      // Exited product detail → reset to defaults and clear storage
      setSortState(DEFAULT_SORT_STATE);
      clearStoredSortState();
      setStatusFilter("active");
      clearStoredStatusFilter();
    }
    wasInDetailRef.current = isNowInDetail;
  }, [input.selectedCampaignAdvertId]);
  useEffect(() => {
    // При входе в новый товар всегда стартуем с фильтра "Активные",
    // даже если в прошлом товаре пользователь выбирал "Все"/"Исключенные".
    setStatusFilter("active");
    writeStoredStatusFilter("active");
  }, [input.productNmId]);
  const [page, setPage] = useState(1);
  const pageSize = 5000;

  const deferredClusterSearch = useDeferredValue(clusterSearch);
  const deferredClusterNameSearch = useDeferredValue(clusterNameSearch);

  useEffect(() => {
    setPage(1);
  }, [
    deferredClusterNameSearch,
    input.selectedCampaignAdvertId,
    input.tableRefreshKey,
    deferredClusterSearch,
    numericFilters,
    statusFilter,
    sortState,
  ]);

  const handleSortChange = useCallback((key: AdvertisingClusterSortKey) => {
    if (key === "productPosition") return; // несортируемая колонка (значение вне строки)
    setSortState((currentValue) => {
      const direction: AdvertisingClusterSortDirection =
        currentValue.key === key
          ? currentValue.direction === "asc" ? "desc" : "asc"
          : getDefaultAdvertisingSortDirection(key);
      const next = { key, direction };
      writeStoredSortState(next);
      return next;
    });
  }, []);

  const handleNumericFilterChange = useCallback(
    (
      key: AdvertisingClusterNumericFilterKey,
      bound: "min" | "max",
      nextValue: string,
    ) => {
      setNumericFilters((currentValue) => ({
        ...currentValue,
        [key]: {
          ...currentValue[key],
          [bound]: nextValue,
        },
      }));
    },
    [],
  );

  const applyNumericFilter = useCallback((_key: AdvertisingClusterNumericFilterKey) => {
    // filter is applied instantly via deferredNumericFilters — no explicit commit needed
  }, []);

  return {
    clusterSearch,
    setClusterSearch,
    clusterNameSearch,
    setClusterNameSearch,
    deferredClusterNameSearch,
    numericFilters,
    statusFilter,
    setStatusFilter: setStatusFilterPersisted,
    sortState,
    deferredClusterSearch,
    page,
    pageSize,
    setPage,
    handleSortChange,
    handleNumericFilterChange,
    applyNumericFilter,
  };
}
