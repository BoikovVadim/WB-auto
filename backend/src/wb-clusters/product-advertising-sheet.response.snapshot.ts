import type {
  ProductAdvertisingSheetResponse,
  ProductAdvertisingSnapshotFit,
  ProductAdvertisingSnapshotSource,
  ProductAdvertisingSnapshotStatus,
} from "./types/product-advertising-sheet.types";

export function withProductAdvertisingSnapshotMeta(
  sheet: ProductAdvertisingSheetResponse,
  input: {
    status: ProductAdvertisingSnapshotStatus;
    fit: ProductAdvertisingSnapshotFit;
    source: ProductAdvertisingSnapshotSource;
    builtAt: string | null;
    requestedStartDate: string | null;
    requestedEndDate: string | null;
    snapshotStartDate: string | null;
    snapshotEndDate: string | null;
    builtFromExportRequestId: string | null;
    lastError: string | null;
  },
): ProductAdvertisingSheetResponse {
  return {
    ...sheet,
    snapshot: {
      status: input.status,
      fit: input.fit,
      source: input.source,
      builtAt: input.builtAt,
      requestedStartDate: input.requestedStartDate,
      requestedEndDate: input.requestedEndDate,
      snapshotStartDate: input.snapshotStartDate,
      snapshotEndDate: input.snapshotEndDate,
      builtFromExportRequestId: input.builtFromExportRequestId,
      lastError: input.lastError,
    },
  };
}

export function createDefaultProductAdvertisingSnapshotMeta(input?: {
  requestedStartDate?: string | null;
  requestedEndDate?: string | null;
}): ProductAdvertisingSheetResponse["snapshot"] {
  return {
    status: "missing",
    fit: "unavailable",
    source: "snapshot_store",
    builtAt: null,
    requestedStartDate: input?.requestedStartDate ?? null,
    requestedEndDate: input?.requestedEndDate ?? null,
    snapshotStartDate: null,
    snapshotEndDate: null,
    builtFromExportRequestId: null,
    lastError: null,
  };
}

