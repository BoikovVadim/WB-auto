import type {
  ExportProductIndexItem,
  MetricValue,
  ProductSearchTextsRangeResponse,
  SearchQueriesExportPayload,
  SearchQueriesPeriod,
  SearchQueryProduct,
  SearchQueryText,
  WbExportJobResponse,
  WbExportListItem,
  WbExportResponse,
  WbRawTable,
} from "./syncClientTypes";
import {
  isIsoDateString,
  isNonEmptyString,
  isRecord,
  isSupportedMethod,
  isSyncEntity,
} from "./syncClientValidatorUtils";

function isMetricValue(value: unknown): value is MetricValue {
  return (
    isRecord(value) &&
    (value.current === null || typeof value.current === "number") &&
    (value.dynamics === null || typeof value.dynamics === "number")
  );
}

function isSearchQueriesPeriod(value: unknown): value is SearchQueriesPeriod {
  return (
    isRecord(value) &&
    isNonEmptyString(value.currentStart) &&
    isNonEmptyString(value.currentEnd) &&
    isNonEmptyString(value.pastStart) &&
    isNonEmptyString(value.pastEnd)
  );
}

function isSearchQueryText(value: unknown): value is SearchQueryText {
  return (
    isRecord(value) &&
    isNonEmptyString(value.text) &&
    (value.frequency === null || typeof value.frequency === "number") &&
    (value.weekFrequency === null || typeof value.weekFrequency === "number") &&
    (value.wbCluster === null ||
      value.wbCluster === undefined ||
      isNonEmptyString(value.wbCluster)) &&
    isMetricValue(value.avgPosition) &&
    isMetricValue(value.orders) &&
    isMetricValue(value.openCard) &&
    isMetricValue(value.addToCart) &&
    isMetricValue(value.openToCart)
  );
}

export function isProductSearchTextsRangeResponse(
  value: unknown,
): value is ProductSearchTextsRangeResponse {
  return (
    isRecord(value) &&
    typeof value.nmId === "number" &&
    isIsoDateString(value.checkedAt) &&
    isRecord(value.period) &&
    isNonEmptyString(value.period.start) &&
    isNonEmptyString(value.period.end) &&
    Array.isArray(value.searchTexts) &&
    value.searchTexts.every((item) => isSearchQueryText(item))
  );
}

function isSearchQueryProduct(value: unknown): value is SearchQueryProduct {
  return (
    isRecord(value) &&
    typeof value.nmId === "number" &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.vendorCode) &&
    isNonEmptyString(value.brandName) &&
    isNonEmptyString(value.subjectName) &&
    isMetricValue(value.avgPosition) &&
    isMetricValue(value.openCard) &&
    isMetricValue(value.addToCart) &&
    isMetricValue(value.openToCart) &&
    isMetricValue(value.orders) &&
    isMetricValue(value.cartToOrder) &&
    isMetricValue(value.visibility) &&
    Array.isArray(value.searchTexts) &&
    value.searchTexts.every((item) => isSearchQueryText(item))
  );
}

function isExportProductIndexItem(value: unknown): value is ExportProductIndexItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.vendorCode) &&
    typeof value.nmId === "number" &&
    Number.isInteger(value.nmId) &&
    value.nmId > 0
  );
}

function hasValidRawTableProjection(value: Record<string, unknown>) {
  if (!Array.isArray(value.rows)) {
    return false;
  }

  if (value.flattenedRows === undefined && value.columns === undefined) {
    return true;
  }

  return (
    Array.isArray(value.flattenedRows) &&
    value.flattenedRows.length === value.rows.length &&
    value.flattenedRows.every((row) => isRecord(row)) &&
    Array.isArray(value.columns) &&
    value.columns.length > 0 &&
    value.columns.every((column) => isNonEmptyString(column))
  );
}

function isRawTableView(value: unknown): value is WbRawTable {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    Array.isArray(value.rows) &&
    value.rows.every((row) => isRecord(row)) &&
    hasValidRawTableProjection(value)
  );
}

function isSearchQueriesExportPayload(
  value: unknown,
): value is SearchQueriesExportPayload {
  return (
    isRecord(value) &&
    isSearchQueriesPeriod(value.period) &&
    isRecord(value.summary) &&
    typeof value.summary.productsCount === "number" &&
    typeof value.summary.searchTextsCount === "number" &&
    typeof value.summary.sourcePagesFetched === "number" &&
    typeof value.summary.productBatchesFetched === "number" &&
    Array.isArray(value.products) &&
    value.products.every((item) => isSearchQueryProduct(item)) &&
    (value.productIndex === undefined ||
      (Array.isArray(value.productIndex) &&
        value.productIndex.every((item) => isExportProductIndexItem(item)))) &&
    (value.wbTables === undefined ||
      (Array.isArray(value.wbTables) && value.wbTables.every((table) => isRawTableView(table))))
  );
}

export function assertExportResponse(
  value: unknown,
): asserts value is WbExportResponse {
  if (!isRecord(value)) {
    throw new Error("Invalid export response.");
  }

  if (
    !isNonEmptyString(value.requestId) ||
    value.exportStatus !== "succeeded" ||
    !isSyncEntity(value.entityType) ||
    !isIsoDateString(value.exportedAt) ||
    value.dataIntegrity !== "valid" ||
    !isRecord(value.endpoint) ||
    !isSupportedMethod(value.endpoint.method) ||
    !isNonEmptyString(value.endpoint.path) ||
    !isNonEmptyString(value.endpoint.documentationUrl) ||
    (value.recordsCount !== null &&
      (typeof value.recordsCount !== "number" || value.recordsCount < 0)) ||
    !isRecord(value.requestMeta) ||
    !isNonEmptyString(value.requestMeta.locale) ||
    typeof value.requestMeta.customPayloadApplied !== "boolean" ||
    (value.requestMeta.period !== undefined &&
      !isSearchQueriesPeriod(value.requestMeta.period)) ||
    (value.requestMeta.rawArchivePath !== undefined &&
      !isNonEmptyString(value.requestMeta.rawArchivePath)) ||
    !isSearchQueriesExportPayload(value.payload)
  ) {
    throw new Error("Invalid export response.");
  }
}

export function assertExportJobResponse(
  value: unknown,
): asserts value is WbExportJobResponse {
  if (!isRecord(value)) {
    throw new Error("Invalid export job response.");
  }

  if (
    !isNonEmptyString(value.requestId) ||
    !isSyncEntity(value.entityType) ||
    (value.status !== "queued" &&
      value.status !== "running" &&
      value.status !== "succeeded" &&
      value.status !== "failed") ||
    !isIsoDateString(value.requestedAt) ||
    (value.startedAt !== null &&
      value.startedAt !== undefined &&
      !isIsoDateString(value.startedAt)) ||
    (value.finishedAt !== null &&
      value.finishedAt !== undefined &&
      !isIsoDateString(value.finishedAt)) ||
    value.dataIntegrity !== "valid" ||
    !isRecord(value.endpoint) ||
    !isSupportedMethod(value.endpoint.method) ||
    !isNonEmptyString(value.endpoint.path) ||
    !isNonEmptyString(value.endpoint.documentationUrl) ||
    !isRecord(value.requestMeta) ||
    !isNonEmptyString(value.requestMeta.locale) ||
    typeof value.requestMeta.customPayloadApplied !== "boolean" ||
    (value.requestMeta.period !== undefined &&
      !isSearchQueriesPeriod(value.requestMeta.period)) ||
    (value.recordsCount !== null &&
      (typeof value.recordsCount !== "number" || value.recordsCount < 0)) ||
    typeof value.resultAvailable !== "boolean" ||
    (value.errorMessage !== null &&
      value.errorMessage !== undefined &&
      !isNonEmptyString(value.errorMessage))
  ) {
    throw new Error("Invalid export job response.");
  }
}

export function assertExportHistoryResponse(
  value: unknown,
): asserts value is WbExportListItem[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        !isRecord(item) ||
        !isNonEmptyString(item.requestId) ||
        !isSyncEntity(item.entityType) ||
        !isIsoDateString(item.exportedAt) ||
        (item.recordsCount !== null &&
          (typeof item.recordsCount !== "number" || item.recordsCount < 0)) ||
        typeof item.productsCount !== "number" ||
        typeof item.searchTextsCount !== "number" ||
        !isSearchQueriesPeriod(item.period) ||
        (item.rawArchivePath !== null &&
          item.rawArchivePath !== undefined &&
          !isNonEmptyString(item.rawArchivePath)),
    )
  ) {
    throw new Error("Invalid export history response.");
  }
}
