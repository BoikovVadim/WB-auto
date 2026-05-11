import type { ProductAdvertisingSheetResponse } from "../../../api/syncClient";

import { normalizeAdvertisingText } from "./snapshot";

export function pickPreferredNumber(currentValue: number | null, nextValue: number | null) {
  return currentValue ?? nextValue;
}

export function pickPreferredBidSyncStatus(
  currentValue: ProductAdvertisingSheetResponse["clusters"][number]["bidSyncStatus"],
  nextValue: ProductAdvertisingSheetResponse["clusters"][number]["bidSyncStatus"],
) {
  const statusPriority: Record<NonNullable<typeof currentValue>, number> = {
    failed: 6,
    throttled: 5,
    sending: 4,
    queued: 3,
    pending: 2,
    confirmed: 1,
  };

  if (!currentValue) {
    return nextValue;
  }
  if (!nextValue) {
    return currentValue;
  }

  return statusPriority[currentValue] >= statusPriority[nextValue] ? currentValue : nextValue;
}

export function pickPreferredActionSyncStatus(
  currentValue: ProductAdvertisingSheetResponse["clusters"][number]["actionSyncStatus"],
  nextValue: ProductAdvertisingSheetResponse["clusters"][number]["actionSyncStatus"],
) {
  const statusPriority: Record<NonNullable<typeof currentValue>, number> = {
    failed: 5,
    throttled: 4,
    sending: 3,
    queued: 2,
    confirmed: 1,
  };

  if (!currentValue) {
    return nextValue;
  }
  if (!nextValue) {
    return currentValue;
  }

  return statusPriority[currentValue] >= statusPriority[nextValue] ? currentValue : nextValue;
}

export function pickLatestIsoDate(currentValue: string | null, nextValue: string | null) {
  if (!currentValue) {
    return nextValue;
  }

  if (!nextValue) {
    return currentValue;
  }

  return Date.parse(nextValue) > Date.parse(currentValue) ? nextValue : currentValue;
}

export function buildAdvertisingClusterGroupKey(input: {
  clusterKey?: string;
  advertId: number | null;
  clusterName: string;
}) {
  if (typeof input.clusterKey === "string" && input.clusterKey.trim()) {
    return input.clusterKey;
  }

  return `${input.advertId ?? "none"}:${normalizeAdvertisingText(input.clusterName)}`;
}
