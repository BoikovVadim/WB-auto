import { useCallback, useMemo, useRef } from "react";

const visibleProductSnapshotLimit = 72;
const backgroundProductSnapshotLimit = 72;
const candidateProductSnapshotLimit = 24;

interface ProductSnapshotTargetProduct {
  nmId: number | null;
}

function toUniqueNmIds(products: ProductSnapshotTargetProduct[]) {
  return Array.from(
    new Set(products.map((product) => product.nmId).filter((value): value is number => value !== null)),
  );
}

export function useProductSnapshotTargets(products: ProductSnapshotTargetProduct[]) {
  const allProductSnapshotNmIds = useMemo(() => toUniqueNmIds(products), [products]);
  const visibleNmIds = useMemo(
    () => toUniqueNmIds(products.slice(0, visibleProductSnapshotLimit)),
    [products],
  );
  const backgroundNmIds = useMemo(
    () =>
      toUniqueNmIds(
        products.slice(
          visibleProductSnapshotLimit,
          visibleProductSnapshotLimit + backgroundProductSnapshotLimit,
        ),
      ),
    [products],
  );

  // Ref instead of state: candidate list is only consumed by prefetch logic,
  // not by any rendered output. Avoiding setState here means mouseEnter over
  // a product row no longer triggers a full WbDashboard re-render.
  const candidateNmIdsRef = useRef<number[]>([]);

  const registerCandidateNmId = useCallback((nmId: number | null) => {
    if (nmId === null || nmId <= 0) {
      return;
    }

    const current = candidateNmIdsRef.current;
    const next = [nmId, ...current.filter((value) => value !== nmId)];
    candidateNmIdsRef.current = next.slice(0, candidateProductSnapshotLimit);
  }, []);

  const readinessNmIds = useMemo(
    () => Array.from(new Set([...visibleNmIds])),
    [visibleNmIds],
  );

  return {
    allProductSnapshotNmIds,
    visibleProductSnapshotNmIds: visibleNmIds,
    backgroundProductSnapshotNmIds: backgroundNmIds,
    readinessProductSnapshotNmIds: readinessNmIds,
    registerCandidateProductSnapshotNmId: registerCandidateNmId,
  };
}
