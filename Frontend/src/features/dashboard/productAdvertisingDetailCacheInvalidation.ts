import {
  invalidateCachedProductWorkspaceClusterQueriesMatching,
  invalidateCachedProductWorkspaceClusterTableMatching,
} from "../../api/productWorkspaceSlicesCache";
import { invalidateCachedProductWorkspace } from "../../api/productWorkspaceClient";

export function invalidateProductDetailCaches(input: {
  nmId: number;
  requestInput: { startDate: string; endDate: string };
  advertId?: number | null;
}) {
  invalidateCachedProductWorkspace(input.nmId, input.requestInput);

  if (input.advertId !== null && input.advertId !== undefined) {
    invalidateCachedProductWorkspaceClusterTableMatching({
      nmId: input.nmId,
      advertId: input.advertId,
      requestInput: input.requestInput,
    });
    invalidateCachedProductWorkspaceClusterQueriesMatching({
      nmId: input.nmId,
      advertId: input.advertId,
      requestInput: input.requestInput,
    });
  }
}
