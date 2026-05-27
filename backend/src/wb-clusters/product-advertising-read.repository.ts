import { Inject, Injectable } from "@nestjs/common";

import type { ProductAdvertisingSheetResponse } from "./wb-clusters.types";
import type { ProductAdvertisingWorkspaceCampaignRowsSnapshot } from "./product-workspace-snapshot.types";
import { WbClustersRepository } from "./wb-clusters.repository";

@Injectable()
export class ProductAdvertisingReadRepository {
  constructor(
    @Inject(WbClustersRepository)
    private readonly wbClustersRepository: WbClustersRepository,
  ) {}

  getProductAdvertisingSheet(
    nmId: number,
    currentPeriod?: { start: string; end: string } | null,
  ): Promise<ProductAdvertisingSheetResponse> {
    return this.wbClustersRepository.getProductAdvertisingSheet({
      nmId,
      currentPeriod: currentPeriod ?? null,
    });
  }

  getWorkspaceClusterRowsSQL(
    nmId: number,
    advertId: number,
    period: { start: string; end: string },
  ): Promise<ProductAdvertisingWorkspaceCampaignRowsSnapshot> {
    return this.wbClustersRepository.getProductWorkspaceCampaignRowsSQL(nmId, advertId, period);
  }

  getWorkspaceClusterQueriesSQL(
    nmId: number,
    advertId: number,
    normalizedClusterName: string,
    period?: { start: string; end: string } | null,
  ): Promise<import("./product-workspace-snapshot.types").ProductAdvertisingWorkspaceClusterQueriesSnapshot> {
    return this.wbClustersRepository.getWorkspaceClusterQueriesSQL(nmId, advertId, normalizedClusterName, period);
  }

  getQuerySearchIndexSQL(nmId: number, advertId: number): Promise<Record<string, string[]>> {
    return this.wbClustersRepository.getQuerySearchIndexSQL(nmId, advertId);
  }
}
