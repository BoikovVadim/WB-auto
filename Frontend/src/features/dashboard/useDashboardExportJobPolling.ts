import { useEffect } from "react";

import { fetchExportStatus, fetchSavedExport, type WbExportJobResponse } from "../../api/syncClient";
import { ui } from "./copy";
import { getSafeMessage } from "./dashboardErrors";

export function useDashboardExportJobPolling(input: {
  activeExportJob: WbExportJobResponse | null;
  refreshHistory: () => Promise<unknown>;
  refreshStatus: () => Promise<unknown>;
  setActiveExportJob: (value: WbExportJobResponse | null) => void;
  setCurrentExport: (value: Awaited<ReturnType<typeof fetchSavedExport>>) => void;
  setError: (value: string | null) => void;
  setSelectedExportId: (value: string | null) => void;
  setStatusNotice: (value: { tone: "info" | "success"; message: string } | null) => void;
}) {
  const {
    activeExportJob,
    refreshHistory,
    refreshStatus,
    setActiveExportJob,
    setCurrentExport,
    setError,
    setSelectedExportId,
    setStatusNotice,
  } = input;
  useEffect(() => {
    if (
      !activeExportJob ||
      (activeExportJob.status !== "queued" && activeExportJob.status !== "running")
    ) {
      return;
    }

    let isCancelled = false;
    let timeoutId: number | null = null;

    const pollExportStatus = async () => {
      try {
        const nextStatus = await fetchExportStatus(activeExportJob.requestId);
        if (isCancelled) {
          return;
        }

        setActiveExportJob(nextStatus);

        if (nextStatus.status === "succeeded" && nextStatus.resultAvailable) {
          const response = await fetchSavedExport(nextStatus.requestId);
          if (isCancelled) {
            return;
          }

          setCurrentExport(response);
          setSelectedExportId(response.requestId);
          setActiveExportJob(null);
          setStatusNotice({
            tone: "success",
            message: ui.exportCompletedMessage,
          });
          await refreshStatus();
          await refreshHistory();
          return;
        }

        if (nextStatus.status === "failed") {
          setError(nextStatus.errorMessage ?? ui.exportError);
          await refreshStatus();
          return;
        }
      } catch (requestError) {
        if (isCancelled) {
          return;
        }

        setError(getSafeMessage(requestError, ui.exportError));
      }

      timeoutId = window.setTimeout(() => {
        void pollExportStatus();
      }, 1_500);
    };

    void pollExportStatus();

    return () => {
      isCancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    activeExportJob,
    refreshHistory,
    refreshStatus,
    setActiveExportJob,
    setCurrentExport,
    setError,
    setSelectedExportId,
    setStatusNotice,
  ]);
}
