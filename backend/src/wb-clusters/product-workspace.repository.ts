import { Inject, Injectable } from "@nestjs/common";

import type {
  ProductAdvertisingWorkspaceCampaignRowsSnapshot,
  ProductAdvertisingWorkspaceClusterQueriesSnapshot,
  StoredProductAdvertisingWorkspaceCampaignRowsRecord,
  StoredProductAdvertisingWorkspaceClusterQueriesRecord,
  StoredProductAdvertisingWorkspaceSnapshotRecord,
} from "./product-workspace-snapshot.types";
import type { StoredProductAdvertisingSheetSnapshotRecord } from "./wb-clusters.repository";
import { WbClustersRepository } from "./wb-clusters.repository";
import type { ProductAdvertisingWorkspaceResponse } from "./wb-clusters.types";

@Injectable()
export class ProductWorkspaceRepository {
  constructor(
    @Inject(WbClustersRepository)
    private readonly wbClustersRepository: WbClustersRepository,
  ) {}

  getWorkspaceSnapshot(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
  }): Promise<StoredProductAdvertisingWorkspaceSnapshotRecord | null> {
    return this.wbClustersRepository.getStoredProductWorkspaceSnapshot(input);
  }

  replaceWorkspaceSnapshot(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
    payload: ProductAdvertisingWorkspaceResponse;
  }) {
    return this.wbClustersRepository.replaceStoredProductWorkspaceSnapshot(input);
  }

  getWorkspaceCampaignRows(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
    advertId: number;
  }): Promise<StoredProductAdvertisingWorkspaceCampaignRowsRecord | null> {
    return this.wbClustersRepository.getStoredProductWorkspaceCampaignRows(input);
  }

  replaceWorkspaceCampaignRows(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
    advertId: number;
    payload: ProductAdvertisingWorkspaceCampaignRowsSnapshot;
  }) {
    return this.wbClustersRepository.replaceStoredProductWorkspaceCampaignRows(input);
  }

  getWorkspaceClusterQueries(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
    advertId: number;
    clusterKey: string;
  }): Promise<StoredProductAdvertisingWorkspaceClusterQueriesRecord | null> {
    return this.wbClustersRepository.getStoredProductWorkspaceClusterQueries(input);
  }

  replaceWorkspaceClusterQueries(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
    advertId: number;
    clusterKey: string;
    clusterName: string;
    payload: ProductAdvertisingWorkspaceClusterQueriesSnapshot;
  }) {
    return this.wbClustersRepository.replaceStoredProductWorkspaceClusterQueries(input);
  }

  batchReplaceWorkspaceClusterQueries(input: {
    nmId: number;
    startDate: string;
    endDate: string;
    schemaVersion: number;
    groups: Array<{
      advertId: number;
      clusterKey: string;
      clusterName: string;
      payload: ProductAdvertisingWorkspaceClusterQueriesSnapshot;
    }>;
  }) {
    return this.wbClustersRepository.batchReplaceStoredProductWorkspaceClusterQueries(input);
  }

  listReadySheetSnapshotsMissingWorkspace(limit = 200): Promise<StoredProductAdvertisingSheetSnapshotRecord[]> {
    return this.wbClustersRepository.listReadyProductAdvertisingSheetSnapshotsMissingWorkspace(limit);
  }
}
