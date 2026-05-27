import { useCallback } from "react";

import {
  fetchProductAdvertisingWorkspace,
  fetchProductAdvertisingWorkspaceClusterTable,
} from "../../api/syncClientAdvertisingRead";
import { clearWorkspaceScrollForProduct } from "./advertising/productAdvertisingWorkspaceScroll";
import { resolveProductAdvertisingDateRangeForProductOpen } from "./advertising/productAdvertisingDateRangeState";
import {
  advertisingUxBudgetsMs,
  startAdvertisingUxBudget,
} from "./advertising/advertisingUxBudgets";
import { resolveProductAdvertisingSheetRequestInput } from "./advertising/useProductAdvertisingRequestInput";
import type {
  DashboardProductOption,
  DashboardWorkspaceActionsInput,
} from "./useDashboardWorkspaceActionTypes";

export function useDashboardProductDetailPrefetch(input: {
  currentExport: DashboardWorkspaceActionsInput["currentExport"];
  productAdvertisingDateRange: DashboardWorkspaceActionsInput["productAdvertisingDateRange"];
  openProductDetail: DashboardWorkspaceActionsInput["openProductDetail"];
  registerCandidateProductSnapshotNmId: DashboardWorkspaceActionsInput["registerCandidateProductSnapshotNmId"];
  queueCandidateWarmup: DashboardWorkspaceActionsInput["queueCandidateWarmup"];
  prefetchCandidateSnapshot: DashboardWorkspaceActionsInput["prefetchCandidateSnapshot"];
  setProductAdvertisingDateRange: DashboardWorkspaceActionsInput["setProductAdvertisingDateRange"];
}) {
  const {
    currentExport,
    productAdvertisingDateRange,
    openProductDetail,
    registerCandidateProductSnapshotNmId,
    queueCandidateWarmup,
    prefetchCandidateSnapshot,
    setProductAdvertisingDateRange,
  } = input;

  const prefetchProductWorkspaceDetail = useCallback(
    async (
      nmId: number | null,
      requestInputOverride?: { startDate: string; endDate: string },
      options?: { warmDefaultClusterTable?: boolean },
    ) => {
      if (nmId === null) {
        return;
      }

      // Always resolve requestInput against the same "product open" date range
      // (sliding month ending today) so hover/focus/click all share the same
      // cache key. Without this, hover pre-warms a stale range and the click
      // opens with a different date → cache miss → visible loading state.
      const requestInput =
        requestInputOverride ??
        resolveProductAdvertisingSheetRequestInput({
          currentExport,
          initialProductAdvertisingSheet: null,
          selectedProductNmId: nmId,
          productAdvertisingDateRange: resolveProductAdvertisingDateRangeForProductOpen(
            productAdvertisingDateRange,
          ),
        });

      const workspace = await fetchProductAdvertisingWorkspace(nmId, requestInput, {
        source: "prefetch",
      }).catch(() => null);
      if (!workspace || !options?.warmDefaultClusterTable) {
        return;
      }

      const defaultAdvertId =
        workspace.defaultCampaignId ??
        workspace.selectedCampaignSummary?.advertId ??
        workspace.campaignTabs?.[0]?.advertId ??
        null;
      if (defaultAdvertId === null) {
        return;
      }

      // Warm the exact default table key used by the detail screen so the first
      // render is a cache hit.
      void fetchProductAdvertisingWorkspaceClusterTable({
        nmId,
        advertId: defaultAdvertId,
        requestInput,
        search: "",
        clusterNameSearch: "",
        status: "active",
        sortKey: "spend",
        sortDirection: "desc",
        page: 1,
        pageSize: 5000,
      }).catch(() => null);
    },
    [currentExport, productAdvertisingDateRange],
  );

  const openProductFromProductsList = useCallback((product: DashboardProductOption) => {
    const nextDateRange = resolveProductAdvertisingDateRangeForProductOpen(
      productAdvertisingDateRange,
    );
    if (product.nmId !== null) {
      const requestInput = resolveProductAdvertisingSheetRequestInput({
        currentExport,
        initialProductAdvertisingSheet: null,
        selectedProductNmId: product.nmId,
        productAdvertisingDateRange: nextDateRange,
      });
      startAdvertisingUxBudget(
        buildWorkspaceBudgetKey(product.nmId, requestInput.startDate, requestInput.endDate),
        "product open shell visible",
        advertisingUxBudgetsMs.repeatProductOpen,
      );
      void prefetchProductWorkspaceDetail(product.nmId, requestInput, {
        warmDefaultClusterTable: true,
      });
      // Always start at top when navigating from the list so all campaign cards
      // are visible. Page refresh keeps the scroll (position not cleared here).
      clearWorkspaceScrollForProduct(product.nmId);
    }

    setProductAdvertisingDateRange(nextDateRange);
    openProductDetail(product);
  }, [
    currentExport,
    openProductDetail,
    productAdvertisingDateRange,
    setProductAdvertisingDateRange,
    prefetchProductWorkspaceDetail,
  ]);

  const handleProductHover = useCallback((nmId: number | null) => {
    registerCandidateProductSnapshotNmId(nmId);
    prefetchCandidateSnapshot(nmId);
    // Warm both workspace shell AND default campaign cluster table so that the
    // detail screen renders from cache when the user clicks after hovering.
    void prefetchProductWorkspaceDetail(nmId, undefined, { warmDefaultClusterTable: true });
  }, [
    prefetchProductWorkspaceDetail,
    prefetchCandidateSnapshot,
    registerCandidateProductSnapshotNmId,
  ]);

  const handleProductFocus = useCallback((nmId: number | null) => {
    registerCandidateProductSnapshotNmId(nmId);
    queueCandidateWarmup(nmId);
    prefetchCandidateSnapshot(nmId);
    void prefetchProductWorkspaceDetail(nmId, undefined, { warmDefaultClusterTable: true });
  }, [
    prefetchCandidateSnapshot,
    queueCandidateWarmup,
    registerCandidateProductSnapshotNmId,
    prefetchProductWorkspaceDetail,
  ]);

  const handleProductOpen = useCallback((product: DashboardProductOption) => {
    registerCandidateProductSnapshotNmId(product.nmId);
    prefetchCandidateSnapshot(product.nmId);
    void prefetchProductWorkspaceDetail(product.nmId, undefined, {
      warmDefaultClusterTable: true,
    });
    openProductFromProductsList(product);
  }, [
    prefetchCandidateSnapshot,
    registerCandidateProductSnapshotNmId,
    openProductFromProductsList,
    prefetchProductWorkspaceDetail,
  ]);

  return {
    prefetchProductWorkspaceDetail,
    handleProductHover,
    handleProductFocus,
    handleProductOpen,
  };
}

function buildWorkspaceBudgetKey(nmId: number, startDate: string, endDate: string) {
  return `workspace:${String(nmId)}:${startDate}:${endDate}`;
}
