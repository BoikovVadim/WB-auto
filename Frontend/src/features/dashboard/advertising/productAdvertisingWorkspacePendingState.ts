import type { ProductAdvertisingWorkspaceResponse } from "../../../api/syncClient";

function clearCampaignSummaryCounts(
  campaign: ProductAdvertisingWorkspaceResponse["campaignTabs"][number],
): ProductAdvertisingWorkspaceResponse["campaignTabs"][number] {
  return {
    ...campaign,
    rowsCount: 0,
    totals: {
      ...campaign.totals,
      activeCount: 0,
      excludedCount: 0,
    },
  };
}

export function buildPendingProductAdvertisingWorkspace(
  workspace: ProductAdvertisingWorkspaceResponse,
): ProductAdvertisingWorkspaceResponse {
  const campaignTabs = workspace.campaignTabs.map(clearCampaignSummaryCounts);

  return {
    ...workspace,
    campaignTabs,
    selectedCampaignSummary: workspace.selectedCampaignSummary
      ? clearCampaignSummaryCounts(workspace.selectedCampaignSummary)
      : null,
    initialClusterTable: null,
  };
}
