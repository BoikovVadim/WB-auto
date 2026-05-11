import { Injectable } from "@nestjs/common";

import { appEnv } from "../common/env";
import type {
  WbCabinetCmpProbeResponse,
  WbCabinetSessionBootstrapResponse,
} from "./wb-clusters.types";
import {
  countWorkbookRows,
  decodeWorkbookBuffer,
  fetchWordsClustersFromCmp,
} from "./wb-cabinet-private-api.cmp";
import {
  buildCmpProbeFailure,
  buildCmpProbeResponse,
  buildWordsClustersFetchError,
} from "./wb-cabinet-private-api.probe";
import {
  extractSessionExpiryFromStorageState,
  extractSupplierIdFromStorageState,
  persistWbCabinetStorageState,
  readWbCabinetStorageState,
  resolveStorageStateSessionStatus,
} from "./wb-cabinet-private-api.storage-state";

@Injectable()
export class WbCabinetPrivateApiClient {
  isEnabled() {
    return appEnv.wbCabinetEnabled;
  }

  async getSessionStatus() {
    const checkedAt = new Date().toISOString();
    if (!this.isEnabled()) {
      return {
        enabled: false,
        status: "disabled" as const,
        storageStatePath: null,
        supplierId: null,
        expiresAt: null,
        checkedAt,
        warning: null,
      };
    }

    try {
      const storageState = await readWbCabinetStorageState();
      const supplierId = extractSupplierIdFromStorageState(storageState);
      const expiresAt = extractSessionExpiryFromStorageState(storageState);
      const status = resolveStorageStateSessionStatus(expiresAt);

      return {
        enabled: true,
        status,
        storageStatePath: appEnv.wbCabinetStorageStatePath,
        supplierId,
        expiresAt,
        checkedAt,
        warning:
          supplierId === null
            ? "WB cabinet storage state is present, but supplier id cookie is missing."
            : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return {
          enabled: true,
          status: "missing" as const,
          storageStatePath: appEnv.wbCabinetStorageStatePath,
          supplierId: null,
          expiresAt: null,
          checkedAt,
          warning: "WB cabinet storage state file is missing.",
        };
      }

      return {
        enabled: true,
        status: "error" as const,
        storageStatePath: appEnv.wbCabinetStorageStatePath,
        supplierId: null,
        expiresAt: null,
        checkedAt,
        warning: message,
      };
    }
  }

  async bootstrapSession(storageStateJson: string): Promise<WbCabinetSessionBootstrapResponse> {
    if (!this.isEnabled()) {
      throw new Error("WB cabinet private API client is disabled.");
    }

    await persistWbCabinetStorageState(storageStateJson);

    const status = await this.getSessionStatus();
    return {
      accepted: true,
      status: status.status,
      storageStatePath: appEnv.wbCabinetStorageStatePath,
      checkedAt: status.checkedAt,
    };
  }

  async exportWordsClusters(advertId: number, nmId: number) {
    await this.ensureReadySession();
    const fetchResponse = await this.fetchWordsClustersFromCmp(advertId, nmId);
    if (!fetchResponse.ok || !fetchResponse.base64) {
      throw new Error(buildWordsClustersFetchError(advertId, nmId, fetchResponse.status));
    }

    const workbookBuffer = decodeWorkbookBuffer(fetchResponse.base64);
    const rowCount = countWorkbookRows(workbookBuffer);

    return {
      workbookBuffer,
      probe: buildCmpProbeResponse({
        advertId,
        nmId,
        fetchResponse,
        rowCount,
      }),
    };
  }

  async probeCmpCampaign(advertId: number, nmId: number): Promise<WbCabinetCmpProbeResponse> {
    try {
      await this.ensureReadySession();
      const fetchResponse = await this.fetchWordsClustersFromCmp(advertId, nmId);
      const rowCount = fetchResponse.base64
        ? countWorkbookRows(decodeWorkbookBuffer(fetchResponse.base64))
        : 0;

      return buildCmpProbeResponse({
        advertId,
        nmId,
        fetchResponse,
        rowCount,
      });
    } catch (error) {
      return buildCmpProbeFailure(advertId, nmId, error);
    }
  }

  private async ensureReadySession() {
    const status = await this.getSessionStatus();
    if (status.status !== "ready") {
      throw new Error(
        `WB cabinet session is not ready: ${status.status}${status.warning ? ` (${status.warning})` : ""}.`,
      );
    }
  }

  private async fetchWordsClustersFromCmp(advertId: number, nmId: number) {
    return fetchWordsClustersFromCmp(advertId, nmId);
  }
}
