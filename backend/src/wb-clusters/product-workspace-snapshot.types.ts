import type {
  ProductAdvertisingClusterQuery,
  ProductAdvertisingWorkspaceClusterRow,
  ProductAdvertisingWorkspaceResponse,
} from "./wb-clusters.types";

export interface ProductAdvertisingWorkspaceCampaignRowsSnapshot {
  checkedAt: string;
  rows: ProductAdvertisingWorkspaceClusterRow[];
  filterCounts: {
    all: number;
    active: number;
    excluded: number;
  };
  querySearchIndex: Record<string, string[]>;
}

export interface ProductAdvertisingWorkspaceClusterQueriesSnapshot {
  checkedAt: string;
  queries: ProductAdvertisingClusterQuery[];
}

export interface StoredProductAdvertisingWorkspaceSnapshotRecord {
  nmId: number;
  startDate: string;
  endDate: string;
  schemaVersion: number;
  payload: ProductAdvertisingWorkspaceResponse;
  syncedAt: string;
}

export interface StoredProductAdvertisingWorkspaceCampaignRowsRecord {
  nmId: number;
  startDate: string;
  endDate: string;
  schemaVersion: number;
  advertId: number;
  payload: ProductAdvertisingWorkspaceCampaignRowsSnapshot;
  syncedAt: string;
}

export interface StoredProductAdvertisingWorkspaceClusterQueriesRecord {
  nmId: number;
  startDate: string;
  endDate: string;
  schemaVersion: number;
  advertId: number;
  clusterKey: string;
  clusterName: string;
  payload: ProductAdvertisingWorkspaceClusterQueriesSnapshot;
  syncedAt: string;
}

export interface StoredProductAdvertisingWorkspaceSnapshotRow {
  nm_id?: string;
  start_date: string;
  end_date: string;
  schema_version: number;
  payload: ProductAdvertisingWorkspaceResponse;
  synced_at: string;
}

export interface StoredProductAdvertisingWorkspaceCampaignRowsRow {
  nm_id?: string;
  start_date: string;
  end_date: string;
  schema_version: number;
  advert_id: string;
  payload: ProductAdvertisingWorkspaceCampaignRowsSnapshot;
  synced_at: string;
}

export interface StoredProductAdvertisingWorkspaceClusterQueriesRow {
  nm_id?: string;
  start_date: string;
  end_date: string;
  schema_version: number;
  advert_id: string;
  cluster_key: string;
  cluster_name: string;
  payload: ProductAdvertisingWorkspaceClusterQueriesSnapshot;
  synced_at: string;
}
