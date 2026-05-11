import type {
  SearchQueriesExportPayload,
  SyncEntity,
  WbExportResponse,
} from "../../../api/syncClient";
import { isRecord } from "./dashboardViewStateTypes";

type PersistedExportSnapshotState = {
  byRequestId: Record<string, WbExportResponse>;
  latestByEntity: Partial<Record<SyncEntity, string>>;
};

const dashboardCurrentExportStorageKey = "wb-dashboard-current-export";

export function readPersistedCurrentExportSnapshot(
  expectedRequestId: string | null,
  entityType: SyncEntity | null,
) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(dashboardCurrentExportStorageKey);
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    if (!isPersistedExportSnapshotState(parsedValue)) {
      return null;
    }

    if (expectedRequestId) {
      const snapshotByRequestId = parsedValue.byRequestId[expectedRequestId];
      if (isExportResponseSnapshot(snapshotByRequestId)) {
        return snapshotByRequestId;
      }
    }

    if (entityType) {
      const latestRequestId = parsedValue.latestByEntity[entityType];
      if (!latestRequestId) {
        return null;
      }

      const snapshotByEntity = parsedValue.byRequestId[latestRequestId];
      return isExportResponseSnapshot(snapshotByEntity) ? snapshotByEntity : null;
    }

    return null;
  } catch {
    return null;
  }
}

export function writePersistedCurrentExportSnapshot(
  selectedExportId: string | null,
  exportResponse: WbExportResponse | null,
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (!selectedExportId || !exportResponse || exportResponse.requestId !== selectedExportId) {
      return;
    }

    const currentValue = readPersistedExportSnapshotState();
    const nextValue: PersistedExportSnapshotState = {
      byRequestId: {
        ...currentValue.byRequestId,
        [selectedExportId]: exportResponse,
      },
      latestByEntity: {
        ...currentValue.latestByEntity,
        [exportResponse.entityType]: selectedExportId,
      },
    };

    window.sessionStorage.setItem(
      dashboardCurrentExportStorageKey,
      JSON.stringify(nextValue),
    );
  } catch {
    return;
  }
}

export function resolveSelectedProductNmId(
  exportResponse: WbExportResponse | null,
  preferredNmId: number | null,
) {
  if (preferredNmId !== null) {
    return preferredNmId;
  }

  if (!exportResponse) {
    return null;
  }

  return null;
}

function readPersistedExportSnapshotState(): PersistedExportSnapshotState {
  if (typeof window === "undefined") {
    return createEmptyPersistedExportSnapshotState();
  }

  try {
    const rawValue = window.sessionStorage.getItem(dashboardCurrentExportStorageKey);
    if (!rawValue) {
      return createEmptyPersistedExportSnapshotState();
    }

    const parsedValue = JSON.parse(rawValue);
    return isPersistedExportSnapshotState(parsedValue)
      ? parsedValue
      : createEmptyPersistedExportSnapshotState();
  } catch {
    return createEmptyPersistedExportSnapshotState();
  }
}

function createEmptyPersistedExportSnapshotState(): PersistedExportSnapshotState {
  return {
    byRequestId: {},
    latestByEntity: {},
  };
}

function isExportResponseSnapshot(value: unknown): value is WbExportResponse {
  return (
    isRecord(value) &&
    typeof value.requestId === "string" &&
    typeof value.exportedAt === "string" &&
    typeof value.entityType === "string" &&
    isRecord(value.requestMeta) &&
    isExportPayload(value.payload)
  );
}

function isPersistedExportSnapshotState(
  value: unknown,
): value is PersistedExportSnapshotState {
  if (!isRecord(value) || !isRecord(value.byRequestId) || !isRecord(value.latestByEntity)) {
    return false;
  }

  for (const snapshot of Object.values(value.byRequestId)) {
    if (!isExportResponseSnapshot(snapshot)) {
      return false;
    }
  }

  for (const latestRequestId of Object.values(value.latestByEntity)) {
    if (latestRequestId !== undefined && typeof latestRequestId !== "string") {
      return false;
    }
  }

  return true;
}

function isExportPayload(value: unknown): value is SearchQueriesExportPayload {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as SearchQueriesExportPayload).products)
  );
}
