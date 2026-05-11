import type {
  ProductAdvertisingSheetResponse,
  ProductAdvertisingWorkspaceResponse,
  ProductCatalogItem,
} from "./wb-clusters.types";
import { buildWorkspaceCampaignTabs } from "./product-workspace.builder.campaign-tabs";
import {
  mergeWorkspaceClusters,
  projectWorkspaceClustersForRange,
} from "./product-workspace.builder.cluster-range";
import { getWorkspaceDailyStatsBounds } from "./product-workspace.builder.dates";

export {
  mergeWorkspaceClusters,
  projectWorkspaceClustersForRange,
} from "./product-workspace.builder.cluster-range";
export {
  addWorkspaceNullableNumbers,
  averageWorkspaceNumbers,
  getWorkspaceCostPerThousand,
  getWorkspaceMoneyPerAction,
  getWorkspaceOrderedItems,
  getWorkspaceRatio,
} from "./product-workspace.builder.math";
export {
  isWorkspaceClusterActive,
  isWorkspaceClusterExcluded,
  normalizeWorkspaceText,
} from "./product-workspace.builder.sources";

export function buildProductAdvertisingWorkspaceResponse(input: {
  sheet: ProductAdvertisingSheetResponse;
  productCatalogItem: ProductCatalogItem | null;
  currentRefresh: {
    syncRunId: string;
    startedAt: string;
  } | null;
  readiness?: ProductAdvertisingWorkspaceResponse["readiness"];
}): ProductAdvertisingWorkspaceResponse {
  const mergedClusters = mergeWorkspaceClusters(input.sheet.clusters);
  const projectedClusters = projectWorkspaceClustersForRange(mergedClusters, input.sheet);
  const campaignTabs = buildWorkspaceCampaignTabs(input.sheet.campaigns, projectedClusters);
  const defaultCampaignId = campaignTabs[0]?.advertId ?? null;
  const dailyStatsBounds = getWorkspaceDailyStatsBounds(input.sheet.dailyStats);

  return {
    nmId: input.sheet.nmId,
    checkedAt: input.sheet.checkedAt,
    readiness: input.readiness ?? {
      scope: "workspace",
      status: "ready",
      source: "sheet_snapshot",
      materializationStatus: "fallback_sheet",
    },
    header: {
      nmId: input.sheet.nmId,
      vendorCode: input.productCatalogItem?.vendorCode ?? null,
      productName: input.productCatalogItem?.name ?? null,
      brandName: input.productCatalogItem?.brandName ?? null,
      subjectName: input.productCatalogItem?.subjectName ?? null,
    },
    snapshot: input.sheet.snapshot,
    range: input.sheet.range,
    dateBounds: {
      minDate: input.sheet.summary.dailyStatsWindowStartDate ?? dailyStatsBounds.minDate,
      maxDate: input.sheet.summary.dailyStatsWindowEndDate ?? dailyStatsBounds.maxDate,
      defaultStartDate: input.sheet.range.startDate,
      defaultEndDate: input.sheet.range.endDate,
    },
    campaignTabs,
    defaultCampaignId,
    selectedCampaignSummary:
      campaignTabs.find((item) => item.advertId === defaultCampaignId) ?? null,
    initialClusterTable: null,
    syncState: {
      hasPendingClusterSync: input.sheet.clusters.some(
        (cluster) =>
          (cluster.bidSyncStatus !== null && cluster.bidSyncStatus !== "confirmed") ||
          (cluster.actionSyncStatus !== null && cluster.actionSyncStatus !== "confirmed"),
      ),
      refreshStatus: input.currentRefresh ? "running" : "idle",
      syncRunId: input.currentRefresh?.syncRunId ?? null,
      startedAt: input.currentRefresh?.startedAt ?? null,
    },
    diagnostics: {
      periodMetricsStatus: input.sheet.summary.periodMetricsStatus,
      periodMetricsActualStartDate: input.sheet.summary.periodMetricsActualStartDate,
      periodMetricsActualEndDate: input.sheet.summary.periodMetricsActualEndDate,
      dailyStatsWindowStartDate: input.sheet.summary.dailyStatsWindowStartDate,
      dailyStatsWindowEndDate: input.sheet.summary.dailyStatsWindowEndDate,
      queryCoverageStatus: input.sheet.summary.queryCoverageStatus,
    },
  };
}
