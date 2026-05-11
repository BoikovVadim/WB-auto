import { useCallback, useRef } from "react";

import { fetchProductCatalog, runProductAdvertisingSync } from "../../api/syncClient";
import { ui } from "./copy";
import { normalizeDashboardReadError } from "./dashboardErrors";
import {
  advertisingUxBudgetsMs,
  startAdvertisingUxBudget,
} from "./advertising/advertisingUxBudgets";
import { resolveProductAdvertisingDateRangeForProductOpen } from "./advertising/productAdvertisingDateRangeState";
import type { ProductAdvertisingDetailInvalidationTarget } from "./advertising/productAdvertisingDetailInvalidation";
import { resolveProductAdvertisingSheetRequestInput } from "./advertising/useProductAdvertisingRequestInput";
import { invalidateProductDetailCaches } from "./productAdvertisingDetailCacheInvalidation";
import { useDashboardProductDetailPrefetch } from "./useDashboardProductDetailPrefetch";
import type {
  DashboardOpenExportOptions,
  DashboardWorkspaceActionsInput,
} from "./useDashboardWorkspaceActionTypes";

export function useDashboardProductActions(input: {
  currentExport: DashboardWorkspaceActionsInput["currentExport"];
  exportHistory: DashboardWorkspaceActionsInput["exportHistory"];
  primaryEntityType: DashboardWorkspaceActionsInput["primaryEntityType"];
  resolvedCatalogProduct: DashboardWorkspaceActionsInput["resolvedCatalogProduct"];
  productAdvertisingSheetRequestInput: DashboardWorkspaceActionsInput["productAdvertisingSheetRequestInput"];
  productAdvertisingDateRange: DashboardWorkspaceActionsInput["productAdvertisingDateRange"];
  openProductsList: DashboardWorkspaceActionsInput["openProductsList"];
  openProductDetail: DashboardWorkspaceActionsInput["openProductDetail"];
  registerCandidateProductSnapshotNmId: DashboardWorkspaceActionsInput["registerCandidateProductSnapshotNmId"];
  queueCandidateWarmup: DashboardWorkspaceActionsInput["queueCandidateWarmup"];
  prefetchCandidateSnapshot: DashboardWorkspaceActionsInput["prefetchCandidateSnapshot"];
  invalidateProductAdvertisingDetail: DashboardWorkspaceActionsInput["invalidateProductAdvertisingDetail"];
  setActiveSection: DashboardWorkspaceActionsInput["setActiveSection"];
  setError: DashboardWorkspaceActionsInput["setError"];
  setStatusNotice: DashboardWorkspaceActionsInput["setStatusNotice"];
  setIsAdvertisingSyncStarting: DashboardWorkspaceActionsInput["setIsAdvertisingSyncStarting"];
  setProductAdvertisingDateRange: DashboardWorkspaceActionsInput["setProductAdvertisingDateRange"];
  setProductsSortDirection: DashboardWorkspaceActionsInput["setProductsSortDirection"];
  prefetchSavedExport: (
    entityType: DashboardWorkspaceActionsInput["primaryEntityType"],
    requestId: string,
  ) => void;
  openExport: (
    entityType: DashboardWorkspaceActionsInput["primaryEntityType"],
    requestId: string,
    targetSection?: "method" | "products",
    options?: DashboardOpenExportOptions,
  ) => void;
}) {
  const {
    currentExport,
    exportHistory,
    primaryEntityType,
    resolvedCatalogProduct,
    productAdvertisingSheetRequestInput,
    productAdvertisingDateRange,
    openProductsList,
    openProductDetail,
    registerCandidateProductSnapshotNmId,
    queueCandidateWarmup,
    prefetchCandidateSnapshot,
    invalidateProductAdvertisingDetail,
    setActiveSection,
    setError,
    setStatusNotice,
    setIsAdvertisingSyncStarting,
    setProductAdvertisingDateRange,
    setProductsSortDirection,
    prefetchSavedExport,
    openExport,
  } = input;
  const prefetchedProductsSectionKeyRef = useRef<string | null>(null);
  const {
    prefetchProductWorkspaceDetail,
    handleProductHover: handlePrefetchedProductHover,
    handleProductFocus: handlePrefetchedProductFocus,
  } = useDashboardProductDetailPrefetch({
    currentExport,
    productAdvertisingDateRange,
    openProductDetail,
    registerCandidateProductSnapshotNmId,
    queueCandidateWarmup,
    prefetchCandidateSnapshot,
    setProductAdvertisingDateRange,
  });
  const latestProductExport =
    exportHistory.find((item) => item.entityType === primaryEntityType) ?? null;
  const prefetchProductsWorkspace = useCallback(() => {
    const nextPrefetchKey = latestProductExport?.requestId ?? "catalog-only";
    if (prefetchedProductsSectionKeyRef.current === nextPrefetchKey) {
      return;
    }

    prefetchedProductsSectionKeyRef.current = nextPrefetchKey;
    void fetchProductCatalog().catch(() => {
      prefetchedProductsSectionKeyRef.current = null;
    });

    if (!latestProductExport) {
      return;
    }

    if (!currentExport || currentExport.requestId !== latestProductExport.requestId) {
      prefetchSavedExport(latestProductExport.entityType, latestProductExport.requestId);
    }
  }, [currentExport, latestProductExport, prefetchSavedExport]);
  const openProductsWorkspace = useCallback(() => {
    setError(null);
    setStatusNotice(null);
    startAdvertisingUxBudget(
      "section:products",
      "section switch products",
      advertisingUxBudgetsMs.sectionSwitch,
    );
    openProductsList();

    if (
      currentExport &&
      latestProductExport &&
      latestProductExport.requestId !== currentExport.requestId
    ) {
      openExport(
        latestProductExport.entityType,
        latestProductExport.requestId,
        "products",
        { preserveProductSelection: false },
      );
      return;
    }

    if (currentExport) {
      setActiveSection("products");
      return;
    }

    if (latestProductExport) {
      openExport(
        latestProductExport.entityType,
        latestProductExport.requestId,
        "products",
        { preserveProductSelection: false },
      );
      return;
    }

    setActiveSection("products");
  }, [
    currentExport,
    latestProductExport,
    openExport,
    openProductsList,
    setActiveSection,
    setError,
    setStatusNotice,
  ]);
  const handleProductHover = useCallback((nmId: number | null) => {
    if (latestProductExport && (!currentExport || currentExport.requestId !== latestProductExport.requestId)) {
      prefetchSavedExport(latestProductExport.entityType, latestProductExport.requestId);
    }
    handlePrefetchedProductHover(nmId);
  }, [
    currentExport,
    handlePrefetchedProductHover,
    latestProductExport,
    prefetchSavedExport,
  ]);
  const handleProductFocus = useCallback((nmId: number | null) => {
    if (latestProductExport && (!currentExport || currentExport.requestId !== latestProductExport.requestId)) {
      prefetchSavedExport(latestProductExport.entityType, latestProductExport.requestId);
    }
    handlePrefetchedProductFocus(nmId);
  }, [
    currentExport,
    handlePrefetchedProductFocus,
    latestProductExport,
    prefetchSavedExport,
  ]);
  const handleProductOpen = useCallback((product: { vendorCode: string; nmId: number | null }) => {
    setError(null);
    if (!latestProductExport) {
      setStatusNotice({
        tone: "info",
        message: ui.productDetailUnavailable,
      });
      return;
    }

    registerCandidateProductSnapshotNmId(product.nmId);
    prefetchCandidateSnapshot(product.nmId);
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
      void prefetchProductWorkspaceDetail(product.nmId, requestInput);
    }
    setProductAdvertisingDateRange(nextDateRange);

    if (currentExport && currentExport.requestId === latestProductExport.requestId) {
      openProductDetail(product);
      return;
    }

    // Экспорт не загружен или устарел — переходим немедленно, данные экспорта
    // подгружаются в фоне. Это устраняет гонку, при которой selectedProductNmId
    // оставался null до завершения асинхронного hydrateExportInBackground.
    openProductDetail(product);
    openExport(latestProductExport.entityType, latestProductExport.requestId, "products", {
      preserveProductSelection: true,
      preferredProductSelection: product,
    });
  }, [
    currentExport,
    latestProductExport,
    openExport,
    openProductDetail,
    prefetchCandidateSnapshot,
    prefetchProductWorkspaceDetail,
    productAdvertisingDateRange,
    registerCandidateProductSnapshotNmId,
    setError,
    setProductAdvertisingDateRange,
    setStatusNotice,
  ]);

  const handleRunAdvertisingSync = useCallback(async () => {
    setIsAdvertisingSyncStarting(true);
    setError(null);
    setStatusNotice({
      tone: "info",
      message: ui.advertisingSyncStarted,
    });

    try {
      await runProductAdvertisingSync();
      if (
        resolvedCatalogProduct?.nmId !== null &&
        resolvedCatalogProduct?.nmId !== undefined &&
        productAdvertisingSheetRequestInput
      ) {
        invalidateProductDetailCaches({
          nmId: resolvedCatalogProduct.nmId,
          requestInput: productAdvertisingSheetRequestInput,
        });
        invalidateProductAdvertisingDetail("all");
      }
    } catch (requestError) {
      setError(normalizeDashboardReadError(requestError, ui.advertisingSyncError));
    } finally {
      setIsAdvertisingSyncStarting(false);
    }
  }, [
    invalidateProductAdvertisingDetail,
    productAdvertisingSheetRequestInput,
    resolvedCatalogProduct,
    setError,
    setIsAdvertisingSyncStarting,
    setStatusNotice,
  ]);

  const handleReloadSelectedProductAdvertising = useCallback(async (options?: {
    advertId?: number | null;
    target?: ProductAdvertisingDetailInvalidationTarget;
    invalidateCaches?: boolean;
  }) => {
    if (
      !resolvedCatalogProduct ||
      resolvedCatalogProduct.nmId === null ||
      !productAdvertisingSheetRequestInput
    ) {
      return;
    }

    if (options?.invalidateCaches !== false) {
      invalidateProductDetailCaches({
        nmId: resolvedCatalogProduct.nmId,
        requestInput: productAdvertisingSheetRequestInput,
        advertId: options?.advertId ?? null,
      });
    }
    invalidateProductAdvertisingDetail(options?.target ?? "all");
  }, [
    invalidateProductAdvertisingDetail,
    productAdvertisingSheetRequestInput,
    resolvedCatalogProduct,
  ]);

  const handleBackToProducts = useCallback(() => {
    openProductsList();
  }, [openProductsList]);

  const handleProductsSortToggle = useCallback(() => {
    setStatusNotice(null);
    startAdvertisingUxBudget(
      "products:list-search",
      "products list search or sort visible",
      advertisingUxBudgetsMs.productsSearchVisible,
    );
    setProductsSortDirection((currentValue) =>
      currentValue === "asc" ? "desc" : "asc",
    );
  }, [setProductsSortDirection, setStatusNotice]);

  return {
    openProductsWorkspace,
    prefetchProductsWorkspace,
    handleRunAdvertisingSync,
    handleReloadSelectedProductAdvertising,
    handleProductHover,
    handleProductFocus,
    handleProductOpen,
    handleBackToProducts,
    handleProductsSortToggle,
  };
}
