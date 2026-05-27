import type { ClusterSourceKind } from "./core.types";

export interface ProductClusterLookupMatch {
  queryText: string;
  clusterName: string;
  sourceKind: ClusterSourceKind;
  mappingSource: "promotion" | "cabinet" | "merged" | "cluster-name" | "stem-fallback";
  isActive: boolean | null;
  advertId: number | null;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  addToCart: number | null;
  shks: number | null;
  updatedAt: string | null;
}

export interface ProductClusterLookupResponse {
  nmId: number;
  checkedAt: string;
  matches: ProductClusterLookupMatch[];
}

export interface ProductCatalogCampaignCounts {
  total: number;
  active: number;
  paused: number;
  disabled: number;
}

export interface ProductCatalogItem {
  nmId: number;
  vendorCode: string;
  name: string;
  brandName: string;
  subjectName: string;
  subjectId: number | null;
  categoryName: string | null;
  sourceExportRequestId: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  syncedAt: string | null;
  campaignCounts: ProductCatalogCampaignCounts;
}

export interface ProductCatalogResponse {
  checkedAt: string;
  items: ProductCatalogItem[];
}
