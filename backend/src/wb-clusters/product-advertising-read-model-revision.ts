import type {
  ProductAdvertisingReadModelRevision,
} from "./wb-clusters.types";
import type { ProductAdvertisingWorkspaceReadinessScope } from "./types/product-advertising-workspace.types";

export function buildProductAdvertisingReadModelRevision(input: {
  scope: ProductAdvertisingWorkspaceReadinessScope;
  nmId: number;
  advertId?: number | null;
  clusterKey?: string | null;
  requestedStartDate?: string | null;
  requestedEndDate?: string | null;
  builtAt: string;
}): ProductAdvertisingReadModelRevision {
  return {
    key: [
      "wb-product-advertising",
      input.scope,
      String(input.nmId),
      input.advertId != null ? String(input.advertId) : "none",
      input.clusterKey?.trim() ? input.clusterKey.trim() : "none",
      input.requestedStartDate ?? "none",
      input.requestedEndDate ?? "none",
      input.builtAt,
    ].join(":"),
    builtAt: input.builtAt,
  };
}
