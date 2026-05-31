import type {
  ProductAdvertisingBidSyncStatus,
  ProductAdvertisingClusterQuery,
  ProductAdvertisingWorkspaceClusterRow,
} from "../../../api/syncClient";
import {
  isAdvertisingCampaignPaused,
  isAdvertisingCampaignRunning,
  isClusterActive,
  isClusterExcluded,
} from "./advertisingModelHelpers";

export function getAdvertisingClusterQueryCount(
  row: ProductAdvertisingWorkspaceClusterRow,
  queries: ProductAdvertisingClusterQuery[],
) {
  // Раскрытый кластер показывает реальный 7-дневный состав (queries.length).
  // Свёрнутый — тот же 7-дневный счётчик из бэкенда (jamQueryCount = окно состава),
  // с fallback на полный кабинетный queryCount, чтобы не было пусто.
  return queries.length > 0 ? queries.length : row.jamQueryCount ?? row.queryCount ?? 0;
}

export function formatAdvertisingClusterQueryCount(queryCount: number) {
  return String(queryCount);
}

export function formatAdvertisingClusterPluralLabel(clusterCount: number) {
  const absCount = Math.abs(clusterCount);
  const lastTwoDigits = absCount % 100;
  const lastDigit = absCount % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return `${String(clusterCount)} кластеров`;
  }

  if (lastDigit === 1) {
    return `${String(clusterCount)} кластер`;
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return `${String(clusterCount)} кластера`;
  }

  return `${String(clusterCount)} кластеров`;
}

export function getAdvertisingClusterRowClass(row: ProductAdvertisingWorkspaceClusterRow) {
  return `wb-advertising-row wb-advertising-row--${getAdvertisingStatusTone(row)}`;
}

export function getAdvertisingQueryRowClass(query: Pick<ProductAdvertisingClusterQuery, "sourceKind" | "isActive">) {
  return `wb-advertising-row wb-advertising-row--${getAdvertisingQueryTone(query)} wb-advertising-query-row`;
}

export function getAdvertisingCampaignStatusTone(status: number | null) {
  if (isAdvertisingCampaignRunning(status)) {
    return "active";
  }
  if (isAdvertisingCampaignPaused(status)) {
    return "paused";
  }
  return "excluded";
}

export function getBidSyncStatusPresentation(
  status: ProductAdvertisingBidSyncStatus | null,
  retryAt: string | null,
  lastError: string | null,
) {
  const retryLabelSuffix = retryAt ? ` Следующая попытка: ${formatRetryEtaLabel(retryAt)}.` : "";
  const errorLabelSuffix = lastError ? ` ${lastError}` : "";

  switch (status) {
    case "queued":
      return {
        symbol: "•",
        className: "wb-advertising-bid-confirmed--queued",
        label: "Ставка поставлена в очередь на отправку в WB",
      };
    case "sending":
      return {
        symbol: "•",
        className: "wb-advertising-bid-confirmed--sending",
        label: "Ставка отправляется в WB",
      };
    case "pending":
      return {
        symbol: "•",
        className: "wb-advertising-bid-confirmed--pending",
        label: `Ставка ожидает подтверждения из кабинета WB.${retryLabelSuffix}${errorLabelSuffix}`.trim(),
      };
    case "throttled":
      return {
        symbol: "•",
        className: "wb-advertising-bid-confirmed--throttled",
        label: `WB временно ограничил изменение ставки.${retryLabelSuffix}${errorLabelSuffix}`.trim(),
      };
    case "failed":
      return {
        symbol: "!",
        className: "wb-advertising-bid-confirmed--failed",
        label: `WB не подтвердил ставку, требуется повтор.${retryLabelSuffix}${errorLabelSuffix}`.trim(),
      };
    case "confirmed":
      return {
        symbol: "✓",
        className: "wb-advertising-bid-confirmed--confirmed",
        label: "Ставка подтверждена в кабинете WB",
      };
    default:
      return null;
  }
}

function getAdvertisingStatusTone(row: ProductAdvertisingWorkspaceClusterRow) {
  if (isClusterExcluded(row)) {
    return "excluded";
  }
  if (isClusterActive(row)) {
    return "active";
  }
  if (row.sourceKind === "stats") {
    return "stats";
  }

  return "query";
}

function getAdvertisingQueryTone(query: Pick<ProductAdvertisingClusterQuery, "sourceKind" | "isActive">) {
  if (query.isActive === false || query.sourceKind === "excluded") {
    return "excluded";
  }
  if (query.sourceKind === "active") {
    return "active";
  }
  if (query.sourceKind === "stats") {
    return "stats";
  }

  return "query";
}

function formatRetryEtaLabel(value: string) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
