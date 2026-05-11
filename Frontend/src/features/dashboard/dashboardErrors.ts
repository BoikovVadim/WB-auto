import { looksBrokenText } from "./dashboardDisplay";

export function getSafeMessage(error: unknown, fallback: string) {
  if (
    isRecord(error) &&
    isRecord(error.response) &&
    isRecord(error.response.data) &&
    typeof error.response.data.message === "string" &&
    error.response.data.message.trim()
  ) {
    return looksBrokenText(error.response.data.message)
      ? fallback
      : error.response.data.message;
  }

  if (error instanceof Error && error.message.trim()) {
    if (/timeout|exceeded|network error|connection reset|socket hang up|fetch failed|econnreset/i.test(error.message)) {
      return fallback;
    }
    return looksBrokenText(error.message) ? fallback : error.message;
  }

  return fallback;
}

export function normalizeDashboardReadError(error: unknown, fallback: string) {
  const statusCode = getHttpStatusCode(error);
  const readinessStatus = getReadinessStatus(error);

  if (readinessStatus === "materialization_pending") {
    return null;
  }

  if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return null;
  }

  if (
    error instanceof Error &&
    /timeout|exceeded|network error|connection reset|socket hang up|fetch failed|econnreset/i.test(
      error.message,
    )
  ) {
    return null;
  }

  return getSafeMessage(error, fallback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getHttpStatusCode(error: unknown) {
  if (
    isRecord(error) &&
    isRecord(error.response) &&
    typeof error.response.status === "number"
  ) {
    return error.response.status;
  }

  return null;
}

function getReadinessStatus(error: unknown) {
  if (
    isRecord(error) &&
    isRecord(error.response) &&
    isRecord(error.response.data) &&
    isRecord(error.response.data.readiness) &&
    typeof error.response.data.readiness.status === "string"
  ) {
    return error.response.data.readiness.status;
  }

  return null;
}
