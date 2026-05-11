import type { WbCabinetSessionStatus } from "./core.types";

export interface WbCabinetSessionBootstrapResponse {
  accepted: boolean;
  status: WbCabinetSessionStatus;
  storageStatePath: string;
  checkedAt: string;
}

export interface WbCabinetCmpProbeResponse {
  advertId: number;
  nmId: number;
  status: "ok" | "failed";
  pageUrl: string;
  capturedAt: string;
  requestCount: number;
  requests: Array<{
    url: string;
    method: string;
    resourceType: string;
    status: number | null;
  }>;
  workbook: {
    ok: boolean;
    status: number | null;
    rowCount: number;
    sourceEndpoint: string | null;
  };
  warning: string | null;
}
