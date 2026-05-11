import { useCallback } from "react";

import {
  exportWbData,
  fetchExportHistory,
  fetchExportMethods,
  fetchIntegrationStatus,
  fetchTokenSession,
  saveRuntimeToken,
  type SyncEntity,
} from "../../api/syncClient";
import { ui } from "./copy";
import { getSafeMessage } from "./dashboardErrors";
import { useDashboardExportJobPolling } from "./useDashboardExportJobPolling";
import type { DashboardWorkspaceActionsInput } from "./useDashboardWorkspaceActionTypes";
import { useDashboardExportNavigation } from "./useDashboardExportNavigation";

function sortExportHistoryNewestFirst(items: DashboardWorkspaceActionsInput["exportHistory"]) {
  return [...items].sort((left, right) => {
    const leftMs = Date.parse(left.exportedAt);
    const rightMs = Date.parse(right.exportedAt);
    if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
      return rightMs - leftMs;
    }

    return right.requestId.localeCompare(left.requestId, "en");
  });
}

export function useDashboardExportActions(input: DashboardWorkspaceActionsInput) {
  const {
    primaryEntityType,
    tokenInput,
    setActiveSection,
    setActiveExportJob,
    setCurrentExport,
    setError,
    setExportHistory,
    setExportMethods,
    setIntegrationStatus,
    setIsExportLoading,
    setSelectedExportId,
    setSelectedMethodEntity,
    setSelectedProductNmId,
    setStatusNotice,
    setTokenInput,
    setTokenSession,
  } = input;

  const refreshStatus = useCallback(async () => {
    const [integrationResponse, tokenResponse, methodsResponse] = await Promise.all([
      fetchIntegrationStatus(),
      fetchTokenSession(),
      fetchExportMethods(),
    ]);
    setIntegrationStatus(integrationResponse);
    setTokenSession(tokenResponse);
    setExportMethods(methodsResponse.filter((method) => method.entityType === primaryEntityType));
  }, [
    primaryEntityType,
    setExportMethods,
    setIntegrationStatus,
    setTokenSession,
  ]);

  const refreshHistory = useCallback(async () => {
    const historyResponse = await fetchExportHistory();
    const visibleHistoryResponse = sortExportHistoryNewestFirst(
      historyResponse.filter((item) => item.entityType === primaryEntityType),
    );
    setExportHistory(visibleHistoryResponse);
    return visibleHistoryResponse;
  }, [primaryEntityType, setExportHistory]);
  const { openExport, openMethod, prefetchSavedExport } = useDashboardExportNavigation({
    actionsInput: input,
    refreshHistory,
  });
  const prefetchMethodLatestExport = useCallback(
    (entityType: SyncEntity) => {
      const latestExport = input.exportHistory.find((item) => item.entityType === entityType);
      if (!latestExport) {
        return;
      }

      prefetchSavedExport(entityType, latestExport.requestId);
    },
    [input.exportHistory, prefetchSavedExport],
  );

  useDashboardExportJobPolling({
    activeExportJob: input.activeExportJob,
    refreshHistory,
    refreshStatus,
    setActiveExportJob,
    setCurrentExport,
    setError,
    setSelectedExportId,
    setStatusNotice,
  });

  const handleRunExport = useCallback(async (entityType: SyncEntity) => {
    setIsExportLoading(true);
    setError(null);
    setStatusNotice(null);

    try {
      const pendingToken = tokenInput.trim();

      if (pendingToken) {
        const tokenResponse = await saveRuntimeToken(pendingToken);
        setTokenSession(tokenResponse);
        setTokenInput("");
      }

      const response = await exportWbData({
        entityType,
      });

      await refreshStatus();
      setActiveSection("method");
      setSelectedMethodEntity(entityType);
      setSelectedExportId(null);
      setCurrentExport(null);
      setActiveExportJob(response);
      setSelectedProductNmId(null);
      setStatusNotice({
        tone: "info",
        message: ui.exportQueuedMessage,
      });
    } catch (requestError) {
      setError(getSafeMessage(requestError, ui.exportError));
      await refreshStatus();
    } finally {
      setIsExportLoading(false);
    }
  }, [
    setActiveSection,
    setActiveExportJob,
    setCurrentExport,
    setError,
    setIsExportLoading,
    setSelectedExportId,
    setSelectedMethodEntity,
    setSelectedProductNmId,
    setStatusNotice,
    setTokenInput,
    setTokenSession,
    tokenInput,
    refreshStatus,
  ]);

  return {
    openExport,
    openMethod,
    prefetchSavedExport,
    prefetchMethodLatestExport,
    handleRunExport,
    refreshStatus,
    refreshHistory,
  };
}
