import { useCallback, useEffect, useRef } from "react";

import {
  fetchSavedExport,
  getCachedSavedExport,
  getCachedSavedExportSync,
  type SyncEntity,
  type WbExportResponse,
} from "../../api/syncClient";
import { ui } from "./copy";
import {
  readPersistedCurrentExportSnapshot,
  resolveSelectedProductNmId,
  type DashboardSection,
} from "./persistence/dashboardViewState";
import {
  advertisingUxBudgetsMs,
  completeAdvertisingUxBudget,
  startAdvertisingUxBudget,
} from "./advertising/advertisingUxBudgets";
import type { DashboardWorkspaceActionsInput } from "./useDashboardWorkspaceActionTypes";
import type {
  DashboardOpenExportOptions,
  DashboardProductOption,
} from "./useDashboardWorkspaceActionTypes";

export function useDashboardExportNavigation(input: {
  actionsInput: DashboardWorkspaceActionsInput;
  refreshHistory: () => Promise<DashboardWorkspaceActionsInput["exportHistory"]>;
}) {
  const latestRequestedExportKeyRef = useRef<string | null>(null);
  const prefetchedExportKeysRef = useRef<Set<string>>(new Set());
  const { actionsInput, refreshHistory } = input;
  const {
    exportHistory,
    methodArchive,
    setActiveSection,
    setCurrentExport,
    setError,
    setIsArchiveLoading,
    setProductsMode,
    setActiveExportJob,
    setSelectedCatalogVendorCode,
    setSelectedExportId,
    setSelectedMethodEntity,
    setSelectedProductNmId,
    setStatusNotice,
  } = actionsInput;

  const applyResolvedExportToState = useCallback(
    (
      entityType: SyncEntity,
      exportResponse: WbExportResponse,
      preserveProductSelection: boolean,
      preferredProductSelection?: DashboardProductOption | null,
    ) => {
      if (exportResponse.entityType !== entityType) {
        return;
      }

      completeAdvertisingUxBudget(buildSavedExportBudgetKey(exportResponse.requestId));
      setActiveExportJob((currentValue) =>
        currentValue?.requestId === exportResponse.requestId ? null : currentValue,
      );
      setCurrentExport(exportResponse);
      if (preserveProductSelection) {
        if (preferredProductSelection) {
          setSelectedProductNmId(preferredProductSelection.nmId);
          setSelectedCatalogVendorCode(preferredProductSelection.vendorCode);
        } else {
          setSelectedProductNmId((currentValue) =>
            resolveSelectedProductNmId(exportResponse, currentValue),
          );
        }
      } else {
        setSelectedProductNmId(null);
        setSelectedCatalogVendorCode(null);
      }
    },
    [setActiveExportJob, setCurrentExport, setSelectedCatalogVendorCode, setSelectedProductNmId],
  );

  const hydrateExportInBackground = useCallback(
    (
      entityType: SyncEntity,
      requestId: string,
      preserveProductSelection: boolean,
      preferredProductSelection?: DashboardProductOption | null,
    ) => {
      const requestKey = `${entityType}:${requestId}`;
      latestRequestedExportKeyRef.current = requestKey;

      void (async () => {
        const cachedExport = await getCachedSavedExport(requestId);
        if (
          latestRequestedExportKeyRef.current !== requestKey ||
          !cachedExport ||
          cachedExport.entityType !== entityType
        ) {
          // Continue to network fetch below when cache is missing or stale.
        } else {
          applyResolvedExportToState(
            entityType,
            cachedExport,
            preserveProductSelection,
            preferredProductSelection,
          );
        }

        try {
          const response = await fetchSavedExport(requestId);
          if (latestRequestedExportKeyRef.current !== requestKey) {
            return;
          }
          applyResolvedExportToState(
            entityType,
            response,
            preserveProductSelection,
            preferredProductSelection,
          );
        } catch (requestError) {
          if (latestRequestedExportKeyRef.current !== requestKey) {
            return;
          }
          void requestError;
          return;
        }
      })();
    },
    [applyResolvedExportToState],
  );

  const openExport = useCallback(
    (
      entityType: SyncEntity,
      requestId: string,
      targetSection: DashboardSection = "method",
      options?: DashboardOpenExportOptions,
    ) => {
      const preserveProductSelection =
        options?.preserveProductSelection ?? targetSection !== "products";
      const preferredProductSelection = options?.preferredProductSelection ?? null;
      setActiveSection(targetSection);
      setProductsMode(
        targetSection === "products" && preserveProductSelection ? "detail" : "list",
      );
      startAdvertisingUxBudget(
        `section:${targetSection}`,
        `section switch ${targetSection}`,
        advertisingUxBudgetsMs.sectionSwitch,
      );
      startAdvertisingUxBudget(
        buildSavedExportBudgetKey(requestId),
        "saved export visible",
        advertisingUxBudgetsMs.savedExportVisible,
      );
      setError(null);
      setStatusNotice(null);
      setActiveExportJob(null);
      setSelectedMethodEntity(entityType);
      setSelectedExportId(requestId);

      const immediateExport =
        readPersistedCurrentExportSnapshot(requestId, entityType) ??
        getCachedSavedExportSync(requestId);
      if (immediateExport?.entityType === entityType) {
        applyResolvedExportToState(
          entityType,
          immediateExport,
          preserveProductSelection,
          preferredProductSelection,
        );
      }

      hydrateExportInBackground(
        entityType,
        requestId,
        preserveProductSelection,
        preferredProductSelection,
      );
    },
    [
      applyResolvedExportToState,
      hydrateExportInBackground,
      setActiveSection,
      setError,
      setProductsMode,
      setActiveExportJob,
      setSelectedExportId,
      setSelectedMethodEntity,
      setStatusNotice,
    ],
  );

  const openMethod = useCallback(
    async (entityType: SyncEntity) => {
      startAdvertisingUxBudget(
        "section:method",
        "section switch method",
        advertisingUxBudgetsMs.sectionSwitch,
      );
      setActiveSection("method");
      setProductsMode("list");
      setSelectedMethodEntity(entityType);
      setError(null);
      setStatusNotice(null);
      setActiveExportJob(null);

      const snapshotExport = readPersistedCurrentExportSnapshot(null, entityType);
      if (snapshotExport) {
        setCurrentExport(snapshotExport);
        setSelectedExportId(snapshotExport.requestId);
        setSelectedProductNmId((currentValue) =>
          resolveSelectedProductNmId(snapshotExport, currentValue),
        );
      }

      const cachedLatestExport = exportHistory.find(
        (item) => item.entityType === entityType,
      );
      const hasImmediateExport = Boolean(snapshotExport ?? cachedLatestExport);
      setIsArchiveLoading(!hasImmediateExport);

      if (cachedLatestExport) {
        openExport(entityType, cachedLatestExport.requestId);
      }

      void refreshHistory()
        .then((historyResponse) => {
          const latestExport = historyResponse.find((item) => item.entityType === entityType);

          if (latestExport) {
            if (latestExport.requestId !== cachedLatestExport?.requestId) {
              openExport(entityType, latestExport.requestId);
            }
            return;
          }

          if (!snapshotExport && !cachedLatestExport) {
            setSelectedExportId(null);
            setCurrentExport(null);
            setProductsMode("list");
            setSelectedProductNmId(null);
          }
        })
        .catch((requestError) => {
          void requestError;
        })
        .finally(() => {
          setIsArchiveLoading(false);
        });
    },
    [
      exportHistory,
      refreshHistory,
      setActiveSection,
      setCurrentExport,
      setError,
      setIsArchiveLoading,
      setProductsMode,
      setSelectedExportId,
      setSelectedMethodEntity,
      setSelectedProductNmId,
      setStatusNotice,
      setActiveExportJob,
      openExport,
    ],
  );

  const prefetchSavedExport = useCallback((entityType: SyncEntity, requestId: string) => {
    const requestKey = `${entityType}:${requestId}`;
    if (prefetchedExportKeysRef.current.has(requestKey)) {
      return;
    }

    prefetchedExportKeysRef.current.add(requestKey);
    void (async () => {
      try {
        const cachedExport = await getCachedSavedExport(requestId);
        if (cachedExport?.entityType === entityType) {
          return;
        }

        await fetchSavedExport(requestId);
      } catch {
        prefetchedExportKeysRef.current.delete(requestKey);
      }
    })();
  }, []);

  useEffect(() => {
    for (const item of methodArchive.slice(0, 4)) {
      prefetchSavedExport(item.entityType, item.requestId);
    }
  }, [methodArchive, prefetchSavedExport]);

  return {
    openExport,
    openMethod,
    prefetchSavedExport,
  };
}

function buildSavedExportBudgetKey(requestId: string) {
  return `saved-export:${requestId}`;
}
