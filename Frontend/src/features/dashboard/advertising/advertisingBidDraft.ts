import type { ProductAdvertisingWorkspaceClusterRow } from "../../../api/syncClient";

export function canEditAdvertisingClusterBid(row: ProductAdvertisingWorkspaceClusterRow) {
  return (
    row.advertId !== null &&
    row.paymentType === "cpm" &&
    row.bidType === "manual" &&
    row.sourceKind !== "excluded" &&
    row.isActive !== false
  );
}

export function normalizeDisplayedBid(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

export function formatBidDraftValue(value: number) {
  const normalized = normalizeDisplayedBid(value);
  if (normalized === null) {
    return "";
  }

  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(2);
}

export function parseBidDraftValue(value: string) {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}
