import type {
  ClusterSourceKind,
  ProductAdvertisingClusterQueryMappingSource,
} from "./wb-clusters.types";
import type { RawAdvertisingSheetClusterQueryRow } from "./wb-clusters.repository.types";
import { WbClustersRepositoryCampaignInventoryRead } from "./wb-clusters.repository.campaign-inventory-read";

// Module-level helpers — defined once, not re-created on every sort comparison.
const ruCollatorPriority = new Intl.Collator("ru", { sensitivity: "base" });

function mappingSourceRank(value: ProductAdvertisingClusterQueryMappingSource): number {
  if (value === "merged") return 0;
  if (value === "cabinet") return 1;
  if (value === "stem-fallback") return 2;
  if (value === "promotion") return 3;
  return 4;
}

function clusterSourceKindRank(value: ClusterSourceKind): number {
  if (value === "stats") return 0;
  if (value === "active") return 1;
  if (value === "excluded") return 2;
  return 3;
}

export abstract class WbClustersRepositoryAdvertisingQueryPriority extends WbClustersRepositoryCampaignInventoryRead {
  protected compareLookupMatchPriority(
    left: RawAdvertisingSheetClusterQueryRow,
    right: RawAdvertisingSheetClusterQueryRow,
  ) {
    const mappingDiff = mappingSourceRank(left.mappingSource) - mappingSourceRank(right.mappingSource);
    if (mappingDiff !== 0) {
      return mappingDiff;
    }

    const sourceKindDiff = clusterSourceKindRank(left.sourceKind) - clusterSourceKindRank(right.sourceKind);
    if (sourceKindDiff !== 0) {
      return sourceKindDiff;
    }

    const statsDiff =
      this.countPresentNumbers(left.views, left.clicks, left.orders, left.addToCart, left.shks) -
      this.countPresentNumbers(right.views, right.clicks, right.orders, right.addToCart, right.shks);
    if (statsDiff !== 0) {
      return -statsDiff;
    }

    const updatedAtDiff = this.compareIsoDateDesc(left.updatedAt, right.updatedAt);
    if (updatedAtDiff !== 0) {
      return updatedAtDiff;
    }

    return ruCollatorPriority.compare(left.clusterName, right.clusterName);
  }

  protected compareIsoDateDesc(left: string | null, right: string | null) {
    const leftValue = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
    const rightValue = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;
    if (leftValue === rightValue) {
      return 0;
    }

    return rightValue - leftValue;
  }

  protected pickPreferredNumber(left: number | null, right: number | null) {
    if (left === null) {
      return right;
    }

    if (right === null) {
      return left;
    }

    return right > left ? right : left;
  }

  protected pickLatestIsoDate(left: string | null, right: string | null) {
    return this.compareIsoDateDesc(left, right) <= 0 ? left : right;
  }

  protected pickPreferredSourceKind(left: ClusterSourceKind, right: ClusterSourceKind) {
    const priority = (value: ClusterSourceKind) => {
      if (value === "stats") {
        return 0;
      }

      if (value === "active") {
        return 1;
      }

      if (value === "excluded") {
        return 2;
      }

      return 3;
    };

    return priority(left) <= priority(right) ? left : right;
  }

  protected countPresentNumbers(...values: Array<number | null>) {
    return values.reduce<number>(
      (count, value) => (value === null ? count : count + 1),
      0,
    );
  }

}
