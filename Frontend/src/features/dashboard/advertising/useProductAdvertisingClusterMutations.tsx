import type { ProductAdvertisingWorkspaceClusterRow } from "../../../api/syncClient";
import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import { useAdvertisingClusterActionMutations } from "./useAdvertisingClusterActionMutations";
import { useAdvertisingClusterBidEditing } from "./useAdvertisingClusterBidEditing";
import { useAdvertisingClusterCopyFeedback } from "./useAdvertisingClusterCopyFeedback";

export function useProductAdvertisingClusterMutations(input: {
  nmId: number | null;
  selectedCampaignAdvertId: number | null;
  selectedClusterRows: ProductAdvertisingWorkspaceClusterRow[];
  hasSelectedPendingClusterActions: boolean;
  clusterRowByKey: Map<string, ProductAdvertisingWorkspaceClusterRow>;
  requestInput: ProductAdvertisingSheetRequestInput | null;
  onClearSelectedClusterKeys: () => void;
  onReloadSheet: (options?: {
    advertId?: number | null;
    target?: "workspace" | "table" | "queries" | "detail" | "all";
    invalidateCaches?: boolean;
  }) => Promise<void>;
}) {
  const {
    isClusterActionSubmitting,
    clusterActionErrorMessage,
    handleApplyClusterAction,
  } = useAdvertisingClusterActionMutations({
    nmId: input.nmId,
    requestInput: input.requestInput,
    selectedCampaignAdvertId: input.selectedCampaignAdvertId,
    selectedClusterRows: input.selectedClusterRows,
    hasSelectedPendingClusterActions: input.hasSelectedPendingClusterActions,
    onClearSelectedClusterKeys: input.onClearSelectedClusterKeys,
    onReloadSheet: input.onReloadSheet,
  });
  const { copiedClusterKey, onCopyClusterName, copiedQueryKey, onCopyQueryText } =
    useAdvertisingClusterCopyFeedback();
  const { bidErrorMessage, renderClusterBidCell } = useAdvertisingClusterBidEditing({
    nmId: input.nmId,
    requestInput: input.requestInput,
    clusterRowByKey: input.clusterRowByKey,
    isClusterActionSubmitting,
    copiedClusterKey,
    onCopyClusterName,
    onReloadSheet: input.onReloadSheet,
  });

  return {
    isClusterActionSubmitting,
    clusterActionErrorMessage,
    bidErrorMessage,
    copiedClusterKey,
    copiedQueryKey,
    handleApplyClusterAction,
    renderClusterBidCell,
    onCopyClusterName,
    onCopyQueryText,
  };
}
