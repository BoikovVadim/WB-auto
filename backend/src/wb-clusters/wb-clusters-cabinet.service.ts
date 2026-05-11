import { Inject, Injectable } from "@nestjs/common";

import { WbCabinetPrivateApiClient } from "./wb-cabinet-private-api.client";
import { WbClustersRepository } from "./wb-clusters.repository";
import type {
  WbCabinetCmpProbeResponse,
  WbCabinetSessionBootstrapResponse,
} from "./wb-clusters.types";

@Injectable()
export class WbClustersCabinetService {
  constructor(
    @Inject(WbCabinetPrivateApiClient)
    private readonly wbCabinetPrivateApiClient: WbCabinetPrivateApiClient,
    @Inject(WbClustersRepository)
    private readonly wbClustersRepository: WbClustersRepository,
  ) {}

  async getCabinetStatus() {
    return this.wbCabinetPrivateApiClient.getSessionStatus();
  }

  async bootstrapCabinetSession(
    storageStateJson: string,
  ): Promise<WbCabinetSessionBootstrapResponse> {
    return this.wbCabinetPrivateApiClient.bootstrapSession(storageStateJson);
  }

  async probeCabinetCmp(
    advertId: number,
    nmId: number,
  ): Promise<WbCabinetCmpProbeResponse> {
    return this.wbCabinetPrivateApiClient.probeCmpCampaign(advertId, nmId);
  }

  async getCabinetQueryMapImportCandidates(input?: {
    limit?: number;
    mode?: "all" | "missing";
  }) {
    return {
      checkedAt: new Date().toISOString(),
      mode: input?.mode ?? "missing",
      candidates: await this.wbClustersRepository.getCabinetQueryMapImportCandidates(input),
    };
  }

  async importCabinetQueryMap(input: {
    advertId: number;
    nmId: number;
    capturedAt: string;
    captureMode?: string;
    sourceEndpoint?: string;
    replaceExisting?: boolean;
    rows: Array<{
      clusterName: string;
      queryText: string;
    }>;
  }) {
    const rowsStored = await this.wbClustersRepository.replaceCabinetClusterQueries({
      advertId: input.advertId,
      nmId: input.nmId,
      captureMode: input.captureMode ?? "safari-single-tab-words-clusters",
      sourceEndpoint: input.sourceEndpoint ?? `/api/v5/words-clusters?advertID=${input.advertId}`,
      capturedAt: input.capturedAt,
      clearExisting: input.replaceExisting ?? true,
      rows: input.rows,
    });

    return {
      accepted: true,
      advertId: input.advertId,
      nmId: input.nmId,
      rowsStored,
      capturedAt: input.capturedAt,
      importedAt: new Date().toISOString(),
    };
  }
}
