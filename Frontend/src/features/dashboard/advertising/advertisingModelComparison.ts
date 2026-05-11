import type { AdvertisingCampaignSummary } from "./advertisingModelTypes";
import type { AdvertisingClusterSortDirection } from "./advertisingTableTypes";

export function compareNullableNumbers(
  left: number | null,
  right: number | null,
  direction: AdvertisingClusterSortDirection,
) {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return direction === "asc" ? left - right : right - left;
}

export function compareNullableStrings(
  left: string | null,
  right: string | null,
  direction: AdvertisingClusterSortDirection,
) {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return direction === "asc"
    ? left.localeCompare(right, "ru")
    : right.localeCompare(left, "ru");
}

export function getAdvertisingCampaignLabel(
  group: Pick<AdvertisingCampaignSummary, "advertId" | "campaignName">,
) {
  if (group.campaignName && group.advertId !== null) {
    return `${group.campaignName} (#${String(group.advertId)})`;
  }

  if (group.campaignName) {
    return group.campaignName;
  }

  return group.advertId !== null ? `Кампания #${String(group.advertId)}` : "Кампания без названия";
}
