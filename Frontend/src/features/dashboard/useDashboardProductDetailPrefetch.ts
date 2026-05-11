import { useCallback } from "react";

import {
  fetchProductAdvertisingWorkspaceBundle,
} from "../../api/syncClientAdvertisingRead";
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
    ) => {
      if (nmId === null) {
        return;
      }

      const requestInput =
        requestInputOverride ??
        resolveProductAdvertisingSheetRequestInput({
          currentExport,
          initialProductAdvertisingSheet: null,
          selectedProductNmId: nmId,
          productAdvertisingDateRange,
        });

      // Bundle-запрос: один round-trip возвращает workspace + таблицы всех РК.
      // Результат кешируется в памяти и sessionStorage — следующий заход мгновенный.
      void fetchProductAdvertisingWorkspaceBundle(nmId, requestInput).catch(() => null);
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
      void prefetchProductWorkspaceDetail(product.nmId, requestInput);
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
    void prefetchProductWorkspaceDetail(nmId);
  }, [
    prefetchProductWorkspaceDetail,
    prefetchCandidateSnapshot,
    registerCandidateProductSnapshotNmId,
  ]);

  const handleProductFocus = useCallback((nmId: number | null) => {
    registerCandidateProductSnapshotNmId(nmId);
    queueCandidateWarmup(nmId);
    prefetchCandidateSnapshot(nmId);
    void prefetchProductWorkspaceDetail(nmId);
  }, [
    prefetchCandidateSnapshot,
    queueCandidateWarmup,
    registerCandidateProductSnapshotNmId,
    prefetchProductWorkspaceDetail,
  ]);

  const handleProductOpen = useCallback((product: DashboardProductOption) => {
    registerCandidateProductSnapshotNmId(product.nmId);
    prefetchCandidateSnapshot(product.nmId);
    void prefetchProductWorkspaceDetail(product.nmId);
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
