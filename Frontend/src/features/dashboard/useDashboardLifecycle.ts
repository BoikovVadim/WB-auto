import { useCallback, useEffect, useRef } from "react";

import type {
  HealthResponse,
  IntegrationStatusResponse,
  TokenSessionResponse,
} from "../../api/syncClient";
import {
  advertisingUxBudgetsMs,
  completeAdvertisingUxBudget,
  startAdvertisingUxBudget,
} from "./advertising/advertisingUxBudgets";
import type { DashboardSection, ProductsMode } from "./persistence/dashboardViewState";
import type { DashboardStatusNotice } from "./useDashboardWorkspaceActionTypes";

type Input = {
  initializeDashboard: () => Promise<void>;
  health: HealthResponse | null;
  integrationStatus: IntegrationStatusResponse | null;
  tokenSession: TokenSessionResponse | null;
  activeSection: DashboardSection;
  productsMode: ProductsMode;
  handleReloadSelectedProductAdvertising: (input: { target: "all" }) => Promise<unknown>;
  setIsDashboardBootstrapComplete: (value: boolean) => void;
  setStatusNotice: (value: DashboardStatusNotice) => void;
};

/**
 * Жизненный цикл дашборда: первичная загрузка на маунте, закрытие UX-бюджетов
 * (shell виден / секция отрисована) и ручной refresh. Вынесено из WbDashboard без
 * изменения поведения (эффекты и зависимости перенесены дословно).
 */
export function useDashboardLifecycle(input: Input): { handleDashboardRefresh: () => void } {
  const {
    initializeDashboard,
    health,
    integrationStatus,
    tokenSession,
    activeSection,
    productsMode,
    handleReloadSelectedProductAdvertising,
    setIsDashboardBootstrapComplete,
    setStatusNotice,
  } = input;

  const initializeDashboardRef = useRef(initializeDashboard);

  useEffect(() => {
    initializeDashboardRef.current = initializeDashboard;
  }, [initializeDashboard]);

  useEffect(() => {
    startAdvertisingUxBudget(
      "dashboard:shell",
      "dashboard shell visible",
      advertisingUxBudgetsMs.dashboardShellVisible,
    );
    void initializeDashboardRef.current().finally(() => {
      setIsDashboardBootstrapComplete(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (health !== null && integrationStatus !== null && tokenSession !== null) {
      completeAdvertisingUxBudget("dashboard:shell");
    }
  }, [health, integrationStatus, tokenSession]);

  useEffect(() => {
    completeAdvertisingUxBudget(`section:${activeSection}`);
  }, [activeSection]);

  const handleDashboardRefresh = useCallback(async () => {
    setStatusNotice(null);
    startAdvertisingUxBudget(
      "dashboard:shell",
      "dashboard shell visible",
      advertisingUxBudgetsMs.dashboardShellVisible,
    );

    if (activeSection === "products" && productsMode === "detail") {
      await handleReloadSelectedProductAdvertising({ target: "all" });
    }

    await initializeDashboard();
  }, [
    activeSection,
    handleReloadSelectedProductAdvertising,
    initializeDashboard,
    productsMode,
    setStatusNotice,
  ]);

  return { handleDashboardRefresh: () => void handleDashboardRefresh() };
}
