import { useCallback, useState } from "react";

import type { ProductAdvertisingSheetRequestInput } from "../../../api/productAdvertisingSheetIdentity";
import { applyProductAdvertisingClusterAction, type ProductAdvertisingWorkspaceClusterRow } from "../../../api/syncClient";
import { ui } from "../copy";
import { getSafeMessage } from "../dashboardErrors";
import {
  applyClusterActionResponsePatch,
  applyOptimisticClusterActionPatch,
  captureProductAdvertisingDetailCacheSnapshot,
  restoreProductAdvertisingDetailCacheSnapshot,
} from "./productAdvertisingOptimisticCaches";

export function useAdvertisingClusterActionMutations(input: {
  nmId: number | null;
  requestInput: ProductAdvertisingSheetRequestInput | null;
  selectedCampaignAdvertId: number | null;
  selectedClusterRows: ProductAdvertisingWorkspaceClusterRow[];
  hasSelectedPendingClusterActions: boolean;
  onClearSelectedClusterKeys: () => void;
  onReloadSheet: (options?: {
    advertId?: number | null;
    target?: "workspace" | "table" | "queries" | "detail" | "all";
    invalidateCaches?: boolean;
  }) => Promise<void>;
}) {
  const {
    nmId,
    requestInput,
    selectedCampaignAdvertId,
    selectedClusterRows,
    hasSelectedPendingClusterActions,
    onClearSelectedClusterKeys,
    onReloadSheet,
  } = input;
  const [isClusterActionSubmitting, setIsClusterActionSubmitting] = useState(false);
  const [clusterActionErrorMessage, setClusterActionErrorMessage] = useState<string | null>(null);

  const handleApplyClusterAction = useCallback(
    async (action: "include" | "exclude") => {
      if (
        nmId === null ||
        requestInput === null ||
        selectedCampaignAdvertId === null ||
        selectedClusterRows.length === 0 ||
        hasSelectedPendingClusterActions
      ) {
        return;
      }

      setIsClusterActionSubmitting(true);
      setClusterActionErrorMessage(null);
      const snapshot = captureProductAdvertisingDetailCacheSnapshot({
        nmId,
        advertId: selectedCampaignAdvertId,
        requestInput,
      });
      applyOptimisticClusterActionPatch({
        nmId,
        advertId: selectedCampaignAdvertId,
        requestInput,
        selectedClusterRows,
        action,
      });
      void onReloadSheet({
        advertId: selectedCampaignAdvertId,
        target: "detail",
        invalidateCaches: false,
      });
      try {
        const response = await applyProductAdvertisingClusterAction(
          nmId,
          selectedCampaignAdvertId,
          action,
          selectedClusterRows.map((row) => row.clusterName),
        );
        applyClusterActionResponsePatch({
          nmId,
          requestInput,
          response,
        });
        onClearSelectedClusterKeys();
        void onReloadSheet({
          advertId: selectedCampaignAdvertId,
          target: "detail",
        });
      } catch (requestError) {
        restoreProductAdvertisingDetailCacheSnapshot({
          nmId,
          requestInput,
          snapshot,
        });
        void onReloadSheet({ advertId: selectedCampaignAdvertId, target: "detail", invalidateCaches: false });
        setClusterActionErrorMessage(
          getSafeMessage(requestError, ui.advertisingClusterActionError),
        );
      } finally {
        setIsClusterActionSubmitting(false);
      }
    },
    [
      hasSelectedPendingClusterActions,
      nmId,
      onClearSelectedClusterKeys,
      onReloadSheet,
      requestInput,
      selectedCampaignAdvertId,
      selectedClusterRows,
    ],
  );

  return {
    isClusterActionSubmitting,
    clusterActionErrorMessage,
    handleApplyClusterAction,
  };
}
