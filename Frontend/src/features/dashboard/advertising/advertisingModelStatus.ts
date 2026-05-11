import type { ProductAdvertisingSheetResponse } from "../../../api/syncClient";

import type { AdvertisingClusterRow } from "./advertisingModelTypes";
import type {
  AdvertisingClusterSortKey,
  AdvertisingClusterStatusFilter,
} from "./advertisingTableTypes";

export function matchesAdvertisingStatusFilter(
  row: AdvertisingClusterRow,
  statusFilter: AdvertisingClusterStatusFilter,
) {
  if (statusFilter === "active") {
    return isClusterActive(row);
  }

  if (statusFilter === "excluded") {
    return isClusterExcluded(row);
  }

  return true;
}

export function isClusterActive(row: AdvertisingClusterRow) {
  return row.sourceKind === "active" && row.isActive !== false;
}

export function isClusterExcluded(row: AdvertisingClusterRow) {
  return row.sourceKind === "excluded" || row.isActive === false;
}

export function isAdvertisingCampaignRunning(status: number | null) {
  return status === 9;
}

export function isAdvertisingCampaignPaused(status: number | null) {
  return status === 11;
}

export function getDefaultAdvertisingSortDirection(key: AdvertisingClusterSortKey) {
  return key === "source" || key === "campaignName" || key === "clusterName"
    ? "asc"
    : "desc";
}

export function formatAdvertisingCampaignStatus(status: number | null) {
  if (status === null) {
    return "Статус не получен";
  }

  if (isAdvertisingCampaignRunning(status)) {
    return "Активна";
  }

  if (isAdvertisingCampaignPaused(status)) {
    return "На паузе";
  }

  return "Неактивна";
}

export function formatAdvertisingStatusIndicatorBaseLabel(row: AdvertisingClusterRow) {
  return isClusterExcluded(row) ? "Неактивен" : "Активен";
}

export function formatAdvertisingQueryIndicatorLabel(query: {
  sourceKind: ProductAdvertisingSheetResponse["clusterQueries"][number]["sourceKind"];
  isActive: boolean | null;
}) {
  return query.isActive === false || query.sourceKind === "excluded"
    ? "Неактивен"
    : "Активен";
}

export function getAdvertisingSourcePriority(
  sourceKind: ProductAdvertisingSheetResponse["clusters"][number]["sourceKind"],
  isActive: boolean | null,
) {
  if (sourceKind === "excluded" || isActive === false) {
    return 0;
  }

  if (sourceKind === "active") {
    return 1;
  }

  if (sourceKind === "stats") {
    return 2;
  }

  return 3;
}
