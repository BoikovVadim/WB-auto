import type {
  ProductAdvertisingWorkspaceCampaignRowsSnapshot,
  ProductAdvertisingWorkspaceClusterQueriesSnapshot,
} from "./product-workspace-snapshot.types";
import type { ProductAdvertisingClusterQuery } from "./types/product-advertising-sheet.types";
import type {
  ProductAdvertisingWorkspaceCampaignTab,
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingWorkspaceResponse,
} from "./wb-clusters.types";
import { buildProductAdvertisingReadModelRevision } from "./product-advertising-read-model-revision";

export function normalizeStoredWorkspacePayload(input: {
  payload: unknown;
  currentRefresh: {
    syncRunId: string;
    startedAt: string;
  } | null;
}): ProductAdvertisingWorkspaceResponse | null {
  if (!isRecord(input.payload)) {
    return null;
  }

  const campaignTabs = normalizeCampaignTabs(input.payload.campaignTabs);
  if (
    typeof input.payload.nmId !== "number" ||
    !isRecord(input.payload.snapshot) ||
    !isRecord(input.payload.range) ||
    !isRecord(input.payload.header) ||
    !isRecord(input.payload.dateBounds) ||
    campaignTabs === null
  ) {
    return null;
  }

  const selectedCampaignSummary = normalizeSelectedCampaignSummary(
    input.payload.selectedCampaignSummary,
    campaignTabs,
  );
  const defaultCampaignId =
    typeof input.payload.defaultCampaignId === "number"
      ? input.payload.defaultCampaignId
      : selectedCampaignSummary?.advertId ?? campaignTabs[0]?.advertId ?? null;
  const basePayload = input.payload as unknown as ProductAdvertisingWorkspaceResponse;
  const revisionValue = isRecord(input.payload.revision) ? input.payload.revision : null;
  const builtAt =
    typeof basePayload.checkedAt === "string" && basePayload.checkedAt.trim()
      ? basePayload.checkedAt
      : new Date().toISOString();

  return {
    ...basePayload,
    revision:
      revisionValue &&
      typeof revisionValue.key === "string" &&
      typeof revisionValue.builtAt === "string"
        ? {
            key: revisionValue.key,
            builtAt: revisionValue.builtAt,
          }
        : buildProductAdvertisingReadModelRevision({
            scope: "workspace",
            nmId: basePayload.nmId,
            requestedStartDate: readNullableString(basePayload.range?.startDate),
            requestedEndDate: readNullableString(basePayload.range?.endDate),
            builtAt,
          }),
    campaignTabs,
    defaultCampaignId,
    selectedCampaignSummary:
      selectedCampaignSummary ??
      campaignTabs.find((item) => item.advertId === defaultCampaignId) ??
      campaignTabs[0] ??
      null,
    initialClusterTable: null,
    readiness: {
      scope: "workspace",
      status: "ready",
      source: "workspace_snapshot",
      materializationStatus: "materialized",
    },
    syncState: {
      hasPendingClusterSync: readBoolean(
        isRecord(input.payload.syncState) ? input.payload.syncState.hasPendingClusterSync : null,
      ),
      refreshStatus: input.currentRefresh ? "running" : "idle",
      syncRunId: input.currentRefresh?.syncRunId ?? null,
      startedAt: input.currentRefresh?.startedAt ?? null,
    },
    diagnostics: normalizeDiagnostics(input.payload.diagnostics),
  };
}

export function normalizeWorkspaceCampaignRowsSnapshot(
  payload: unknown,
  fallbackCheckedAt: string,
): ProductAdvertisingWorkspaceCampaignRowsSnapshot {
  const rows = normalizeClusterRows(isRecord(payload) ? payload.rows : null);
  const filterCounts = isRecord(payload) ? payload.filterCounts : null;

  return {
    checkedAt:
      isRecord(payload) && typeof payload.checkedAt === "string" && payload.checkedAt.trim()
        ? payload.checkedAt
        : fallbackCheckedAt,
    rows,
    filterCounts: {
      all: readNumber(filterCounts, "all", rows.length),
      active: readNumber(filterCounts, "active", 0),
      excluded: readNumber(filterCounts, "excluded", 0),
    },
    querySearchIndex: normalizeQuerySearchIndex(isRecord(payload) ? payload.querySearchIndex : null),
  };
}

export function normalizeWorkspaceClusterQueriesSnapshot(
  payload: unknown,
  fallbackCheckedAt: string,
): ProductAdvertisingWorkspaceClusterQueriesSnapshot {
  return {
    checkedAt:
      isRecord(payload) && typeof payload.checkedAt === "string" && payload.checkedAt.trim()
        ? payload.checkedAt
        : fallbackCheckedAt,
    queries: normalizeClusterQueries(isRecord(payload) ? payload.queries : null),
  };
}

function normalizeCampaignTabs(value: unknown): ProductAdvertisingWorkspaceCampaignTab[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter(
    (item): item is ProductAdvertisingWorkspaceCampaignTab =>
      isRecord(item) && typeof item.advertId === "number",
  );
}

function normalizeSelectedCampaignSummary(
  value: unknown,
  campaignTabs: ProductAdvertisingWorkspaceCampaignTab[],
) {
  if (!isRecord(value) || typeof value.advertId !== "number") {
    return null;
  }

  return campaignTabs.find((item) => item.advertId === value.advertId) ?? null;
}

function normalizeDiagnostics(value: unknown): ProductAdvertisingWorkspaceResponse["diagnostics"] {
  const diagnostics = isRecord(value) ? value : {};

  return {
    periodMetricsStatus: readStringUnion(
      diagnostics.periodMetricsStatus,
      ["exact", "partial", "unavailable"],
      "unavailable",
    ),
    periodMetricsActualStartDate: readNullableString(diagnostics.periodMetricsActualStartDate),
    periodMetricsActualEndDate: readNullableString(diagnostics.periodMetricsActualEndDate),
    dailyStatsWindowStartDate: readNullableString(diagnostics.dailyStatsWindowStartDate),
    dailyStatsWindowEndDate: readNullableString(diagnostics.dailyStatsWindowEndDate),
    queryCoverageStatus: readStringUnion(
      diagnostics.queryCoverageStatus,
      ["no-clusters", "missing-query-map", "partial", "ready"],
      "no-clusters",
    ),
  };
}

function normalizeQuerySearchIndex(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      Array.isArray(entry) ? entry.filter((item): item is string => typeof item === "string") : [],
    ]),
  );
}

function normalizeClusterRows(value: unknown): ProductAdvertisingWorkspaceClusterRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is ProductAdvertisingWorkspaceClusterRow =>
      isRecord(item) && typeof item.clusterKey === "string",
  );
}

function normalizeClusterQueries(value: unknown): ProductAdvertisingClusterQuery[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is ProductAdvertisingClusterQuery =>
      isRecord(item) && typeof item.queryText === "string",
  );
}

function readBoolean(value: unknown) {
  return value === true;
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown, key: string, fallbackValue: number) {
  if (!isRecord(value)) {
    return fallbackValue;
  }

  const entry = value[key];
  return typeof entry === "number" && Number.isFinite(entry) ? entry : fallbackValue;
}

function readStringUnion<TValue extends string>(
  value: unknown,
  allowedValues: readonly TValue[],
  fallbackValue: TValue,
): TValue {
  return typeof value === "string" && allowedValues.includes(value as TValue)
    ? (value as TValue)
    : fallbackValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
