import { useCallback } from "react";

import {
  clearRuntimeToken,
  saveRuntimeToken,
  type TokenSessionResponse,
} from "../../api/syncClient";
import { ui } from "./copy";
import { getSafeMessage } from "./dashboardErrors";
import type { DashboardWorkspaceActionsInput } from "./useDashboardWorkspaceActionTypes";

export function useDashboardTokenActions(input: {
  tokenInput: DashboardWorkspaceActionsInput["tokenInput"];
  setError: DashboardWorkspaceActionsInput["setError"];
  setStatusNotice: DashboardWorkspaceActionsInput["setStatusNotice"];
  setIsTokenSaving: DashboardWorkspaceActionsInput["setIsTokenSaving"];
  setTokenInput: DashboardWorkspaceActionsInput["setTokenInput"];
  setTokenSession: DashboardWorkspaceActionsInput["setTokenSession"];
  refreshStatus: () => Promise<unknown>;
}) {
  const buildOptimisticTokenSession = useCallback(
    (tokenSource: TokenSessionResponse["tokenSource"], tokenConfigured: boolean) => ({
      tokenConfigured,
      tokenSource,
      updatedAt: new Date().toISOString(),
    }),
    [],
  );
  const handleSaveToken = useCallback(async () => {
    const token = input.tokenInput.trim();

    if (!token) {
      input.setError(ui.tokenError);
      return;
    }

    input.setIsTokenSaving(true);
    input.setError(null);
    input.setStatusNotice(null);
    input.setTokenSession(buildOptimisticTokenSession("runtime", true));
    input.setTokenInput("");

    try {
      const tokenResponse = await saveRuntimeToken(token);
      input.setTokenSession(tokenResponse);
      await input.refreshStatus();
      input.setStatusNotice({
        tone: "success",
        message: ui.tokenSaved,
      });
    } catch (requestError) {
      input.setError(getSafeMessage(requestError, ui.tokenError));
    } finally {
      input.setIsTokenSaving(false);
    }
  }, [buildOptimisticTokenSession, input]);

  const handleClearToken = useCallback(async () => {
    input.setIsTokenSaving(true);
    input.setError(null);
    input.setStatusNotice(null);
    input.setTokenSession(buildOptimisticTokenSession("missing", false));
    input.setTokenInput("");

    try {
      const tokenResponse = await clearRuntimeToken();
      input.setTokenSession(tokenResponse);
      await input.refreshStatus();
      input.setStatusNotice({
        tone: "success",
        message: ui.tokenCleared,
      });
    } catch (requestError) {
      input.setError(getSafeMessage(requestError, ui.tokenError));
    } finally {
      input.setIsTokenSaving(false);
    }
  }, [buildOptimisticTokenSession, input]);

  return {
    handleSaveToken,
    handleClearToken,
  };
}
