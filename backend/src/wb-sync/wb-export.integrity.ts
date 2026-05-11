import type {
  SyncPreviewResponse,
  WbExportJobResponse,
  WbExportResponse,
} from "./wb-sync.types";

export function assertSyncPreviewIntegrity(preview: SyncPreviewResponse) {
  if (!preview.jobId.trim()) {
    throw new Error("Sync preview jobId must not be empty");
  }

  if (!preview.audit.requestedAt.trim() || !preview.audit.requestedBy.trim()) {
    throw new Error("Sync preview audit fields must not be empty");
  }

  if (preview.nextStepCodes.length === 0) {
    throw new Error("Sync preview nextStepCodes must contain values");
  }
}

export function assertWbExportIntegrity(response: WbExportResponse) {
  if (!response.requestId.trim()) {
    throw new Error("Export response requestId must not be empty");
  }

  if (!response.exportedAt.trim()) {
    throw new Error("Export response exportedAt must not be empty");
  }

  if (
    response.entityType !== "search_queries" &&
    response.entityType !== "product_search_texts"
  ) {
    throw new Error("Export response entityType must be supported");
  }

  if (!response.requestMeta.period) {
    throw new Error("Export response requestMeta.period must be present");
  }

  if (!response.payload.period.currentStart.trim()) {
    throw new Error("Export response payload period must not be empty");
  }

  if (
    response.payload.productIndex &&
    response.payload.productIndex.some(
      (item) =>
        !item.vendorCode.trim() || !Number.isInteger(item.nmId) || item.nmId <= 0,
    )
  ) {
    throw new Error("Export response payload productIndex must contain valid items");
  }
}

export function assertWbExportJobIntegrity(response: WbExportJobResponse) {
  if (!response.requestId.trim()) {
    throw new Error("Export job response requestId must not be empty");
  }

  if (!response.requestedAt.trim()) {
    throw new Error("Export job response requestedAt must not be empty");
  }

  if (
    response.entityType !== "search_queries" &&
    response.entityType !== "product_search_texts"
  ) {
    throw new Error("Export job response entityType must be supported");
  }

  if (
    response.status !== "queued" &&
    response.status !== "running" &&
    response.status !== "succeeded" &&
    response.status !== "failed"
  ) {
    throw new Error("Export job response status must be supported");
  }

  if (!response.requestMeta.locale.trim()) {
    throw new Error("Export job response requestMeta.locale must not be empty");
  }
}
