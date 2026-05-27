import { useCallback } from "react";

import type {
  ExportMethodStatus,
  HealthResponse,
  IntegrationStatusResponse,
  SyncEntity,
  TokenSessionResponse,
  WbExportListItem,
  WbExportResponse,
} from "../../api/syncClient";
import {
  fetchExportHistory,
  fetchExportMethods,
  fetchHealth,
  fetchIntegrationStatus,
  fetchTokenSession,
} from "../../api/syncClient";
import type { DashboardSection, ProductsMode } from "./persistence/dashboardViewState";
import type { DashboardOpenExportOptions } from "./useDashboardWorkspaceActionTypes";
import { startQueryFrequenciesPrefetch } from "./queryFrequenciesPrefetch";

function sortExportHistoryNewestFirst(items: WbExportListItem[]) {
  return [...items].sort((left, right) => {
    const leftMs = Date.parse(left.exportedAt);
    const rightMs = Date.parse(right.exportedAt);
    if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
      return rightMs - leftMs;
    }

    return right.requestId.localeCompare(left.requestId, "en");
  });
}

export function useDashboardBootstrap(input: {
  activeSection: DashboardSection;
  productsMode: ProductsMode;
  selectedMethodEntity: SyncEntity | null;
  selectedExportId: string | null;
  primaryEntityType: SyncEntity;
  setError: (value: string | null) => void;
  setHealth: (value: HealthResponse | null) => void;
  setIntegrationStatus: (value: IntegrationStatusResponse | null) => void;
  setTokenSession: (value: TokenSessionResponse | null) => void;
  setExportMethods: (value: ExportMethodStatus[]) => void;
  setExportHistory: (value: WbExportListItem[]) => void;
  setSelectedMethodEntity: (value: SyncEntity | null) => void;
  setSelectedExportId: (value: string | null) => void;
  setCurrentExport: (value: WbExportResponse | null) => void;
  setProductsMode: (value: ProductsMode) => void;
  setSelectedProductNmId: (value: number | null) => void;
  openExport: (
    entityType: SyncEntity,
    requestId: string,
    targetSection?: DashboardSection,
    options?: DashboardOpenExportOptions,
  ) => void;
  getSafeMessage: (error: unknown, fallback: string) => string;
  backendErrorMessage: string;
}) {
  const {
    activeSection,
    openExport,
    primaryEntityType,
    productsMode,
    selectedExportId,
    selectedMethodEntity,
    setCurrentExport,
    setError,
    setExportHistory,
    setExportMethods,
    setHealth,
    setIntegrationStatus,
    setProductsMode,
    setSelectedExportId,
    setSelectedMethodEntity,
    setSelectedProductNmId,
    setTokenSession,
  } = input;
  return useCallback(async () => {
    setError(null);
    const restoredActiveSection = activeSection;
    const restoredProductsMode = productsMode;
    const restoredMethodEntity = selectedMethodEntity;
    const restoredExportId = selectedExportId;
    const tryRestorePersistedExport = (
      targetSection: DashboardSection,
      options?: DashboardOpenExportOptions,
    ) => {
      if (!restoredMethodEntity || !restoredExportId) {
        return false;
      }

      openExport(restoredMethodEntity, restoredExportId, targetSection, options);
      return true;
    };
    const rememberBootstrapError = (() => {
      return {
        set(_requestError: unknown) {},
        flush() {},
      };
    })();

    if (restoredActiveSection === "products") {
      tryRestorePersistedExport("products", {
        preserveProductSelection: restoredProductsMode === "detail",
      });
    } else if (restoredMethodEntity && restoredExportId) {
      tryRestorePersistedExport(restoredActiveSection, {
        preserveProductSelection: true,
      });
    }

    startQueryFrequenciesPrefetch();

    const shellRefreshPromise = Promise.allSettled([
      fetchHealth(),
      fetchIntegrationStatus(),
      fetchTokenSession(),
      fetchExportMethods(),
    ]);
    const exportHistoryPromise = fetchExportHistory()
      .then((historyResponse) =>
        sortExportHistoryNewestFirst(
          historyResponse.filter((item) => item.entityType === primaryEntityType),
        ),
      )
      .catch((requestError) => {
        rememberBootstrapError.set(requestError);
        return null;
      });

    const shellResults = await shellRefreshPromise;
    const [healthResult, integrationResult, tokenResult, methodsResult] = shellResults;

    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value);
    } else {
      rememberBootstrapError.set(healthResult.reason);
    }
    if (integrationResult.status === "fulfilled") {
      setIntegrationStatus(integrationResult.value);
    } else {
      rememberBootstrapError.set(integrationResult.reason);
    }
    if (tokenResult.status === "fulfilled") {
      setTokenSession(tokenResult.value);
    } else {
      rememberBootstrapError.set(tokenResult.reason);
    }
    if (methodsResult.status === "fulfilled") {
      setExportMethods(methodsResult.value.filter((method) => method.entityType === primaryEntityType));
    } else {
      rememberBootstrapError.set(methodsResult.reason);
    }

    const visibleHistoryResponse = await exportHistoryPromise;
    if (visibleHistoryResponse) {
      setExportHistory(visibleHistoryResponse);
    }

    rememberBootstrapError.flush();

    if (!visibleHistoryResponse) {
      return;
    }

    if (restoredActiveSection === "products") {
      if (restoredMethodEntity && restoredExportId) {
        return;
      }

      const latestProductExport = visibleHistoryResponse[0] ?? null;
      if (latestProductExport) {
        openExport(latestProductExport.entityType, latestProductExport.requestId, "products", {
          preserveProductSelection: false,
        });
      }
      return;
    }

    if (restoredMethodEntity) {
      const restoredExport = visibleHistoryResponse.find(
        (item) => item.entityType === restoredMethodEntity,
      );

      if (restoredExport) {
        if (restoredExport.requestId !== restoredExportId) {
          openExport(restoredMethodEntity, restoredExport.requestId, restoredActiveSection, {
            preserveProductSelection: true,
          });
        }
      } else {
        setSelectedMethodEntity(null);
        setSelectedExportId(null);
        setCurrentExport(null);
        setProductsMode("list");
        setSelectedProductNmId(null);
      }
      return;
    }

    if (restoredExportId) {
      const matchedExport = visibleHistoryResponse.find(
        (item) => item.requestId === restoredExportId,
      );
      if (matchedExport) {
        openExport(matchedExport.entityType, matchedExport.requestId, restoredActiveSection, {
          preserveProductSelection: true,
        });
      }
    }
  }, [
    activeSection,
    openExport,
    primaryEntityType,
    productsMode,
    selectedExportId,
    selectedMethodEntity,
    setCurrentExport,
    setError,
    setExportHistory,
    setExportMethods,
    setHealth,
    setIntegrationStatus,
    setProductsMode,
    setSelectedExportId,
    setSelectedMethodEntity,
    setSelectedProductNmId,
    setTokenSession,
  ]);
}
