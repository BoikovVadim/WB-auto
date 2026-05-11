import type {
  SearchQueriesExportPayload,
  TokenSessionResponse,
} from "../../api/syncClient";
import { ui } from "./copy";

export function translateTokenSource(source: TokenSessionResponse["tokenSource"]) {
  switch (source) {
    case "runtime":
      return ui.runtimeSource;
    case "env":
      return ui.envSource;
    case "missing":
      return ui.missingSource;
  }
}

export function formatDateTime(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("ru-RU", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function formatPeriod(period: SearchQueriesExportPayload["period"]) {
  return `${period.currentStart} - ${period.currentEnd}`;
}

export function getMethodStateLabel(waitSeconds: number) {
  return waitSeconds > 0 ? ui.methodCooldown : ui.methodStatus;
}

export function getMethodStateValue(waitSeconds: number) {
  return waitSeconds > 0 ? formatDuration(waitSeconds) : ui.readyForRun;
}

export function getMethodCooldownWaitSeconds(nextAvailableAt: string | null | undefined) {
  if (!nextAvailableAt) {
    return 0;
  }

  const nextAvailableAtMs = Date.parse(nextAvailableAt);
  if (!Number.isFinite(nextAvailableAtMs)) {
    return 0;
  }

  return Math.max(0, Math.ceil((nextAvailableAtMs - Date.now()) / 1000));
}

function formatDuration(value: number) {
  const safeValue = Math.max(0, value);
  const hours = Math.floor(safeValue / 3600);
  const minutes = Math.floor((safeValue % 3600) / 60);
  const seconds = safeValue % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
