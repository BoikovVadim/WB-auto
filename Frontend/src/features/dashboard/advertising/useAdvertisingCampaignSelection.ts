import { useEffect, useMemo, useState } from "react";

import type { ProductAdvertisingWorkspaceResponse } from "../../../api/syncClient";
import type { AdvertisingDateBounds } from "./date";
import { parseAdvertisingDayValue } from "./date";

function getCampaignStatusPriority(status: number | null | undefined): number {
  if (status === 9) return 0;  // active / running
  if (status === 11) return 1; // paused
  return 2;                    // disabled / excluded
}

export function useAdvertisingCampaignSelection(
  workspace: ProductAdvertisingWorkspaceResponse | null,
) {
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  // Sort by status priority (active → paused → disabled) so campaignSummaries[0]
  // always matches the visually top card in ProductAdvertisingClusterOverview.
  const campaignSummaries = useMemo(
    () =>
      [...(workspace?.campaignTabs ?? [])].sort(
        (a, b) =>
          getCampaignStatusPriority(a.campaignStatus) -
          getCampaignStatusPriority(b.campaignStatus),
      ),
    [workspace],
  );
  const clusterDailyStatsBounds = useMemo<AdvertisingDateBounds>(() => {
    const workspaceMinDate = workspace?.dateBounds.minDate
      ? parseAdvertisingDayValue(workspace.dateBounds.minDate)
      : null;
    const workspaceMaxDate = workspace?.dateBounds.maxDate
      ? parseAdvertisingDayValue(workspace.dateBounds.maxDate)
      : null;

    if (workspaceMinDate && workspaceMaxDate) {
      return {
        min: workspaceMinDate,
        max: workspaceMaxDate,
      };
    }

    return null;
  }, [workspace]);
  const selectedCampaign = useMemo(
    () =>
      campaignSummaries.find((item) => item.advertId === selectedCampaignId) ??
      campaignSummaries[0] ??
      null,
    [campaignSummaries, selectedCampaignId],
  );

  useEffect(() => {
    if (campaignSummaries.length === 0) {
      setSelectedCampaignId(null);
      return;
    }

    setSelectedCampaignId((currentValue) => {
      if (
        currentValue !== null &&
        campaignSummaries.some((item) => item.advertId === currentValue)
      ) {
        return currentValue;
      }

      return campaignSummaries[0]?.advertId ?? null;
    });
  }, [campaignSummaries]);

  return {
    campaignSummaries,
    clusterDailyStatsBounds,
    selectedCampaign,
    selectedCampaignId,
    setSelectedCampaignId,
  };
}
