export interface ProductClusterLookupMatch {
  queryText: string;
  clusterName: string;
  sourceKind: "active" | "excluded" | "stats" | "query-map";
  mappingSource: "promotion" | "cabinet" | "merged" | "cluster-name";
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
