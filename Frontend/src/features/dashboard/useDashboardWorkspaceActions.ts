import { useDashboardExportActions } from "./useDashboardExportActions";
import { useDashboardProductActions } from "./useDashboardProductActions";
import { useDashboardTokenActions } from "./useDashboardTokenActions";
import type { DashboardWorkspaceActionsInput } from "./useDashboardWorkspaceActionTypes";

export function useDashboardWorkspaceActions(input: DashboardWorkspaceActionsInput) {
  const {
    openExport,
    openMethod,
    prefetchSavedExport,
    prefetchMethodLatestExport,
    handleRunExport,
    refreshStatus,
  } = useDashboardExportActions(input);
  const { handleSaveToken, handleClearToken } = useDashboardTokenActions({
    tokenInput: input.tokenInput,
    setError: input.setError,
    setStatusNotice: input.setStatusNotice,
    setIsTokenSaving: input.setIsTokenSaving,
    setTokenInput: input.setTokenInput,
    setTokenSession: input.setTokenSession,
    refreshStatus,
  });
  const {
    openProductsWorkspace,
    prefetchProductsWorkspace,
    handleRunAdvertisingSync,
    handleReloadSelectedProductAdvertising,
    handleProductHover,
    handleProductFocus,
    handleProductOpen,
    handleBackToProducts,
    handleProductsSortToggle,
  } = useDashboardProductActions({
    currentExport: input.currentExport,
    exportHistory: input.exportHistory,
    primaryEntityType: input.primaryEntityType,
    resolvedCatalogProduct: input.resolvedCatalogProduct,
    productAdvertisingSheetRequestInput: input.productAdvertisingSheetRequestInput,
    productAdvertisingDateRange: input.productAdvertisingDateRange,
    openProductsList: input.openProductsList,
    openProductDetail: input.openProductDetail,
    registerCandidateProductSnapshotNmId: input.registerCandidateProductSnapshotNmId,
    queueCandidateWarmup: input.queueCandidateWarmup,
    prefetchCandidateSnapshot: input.prefetchCandidateSnapshot,
    invalidateProductAdvertisingDetail: input.invalidateProductAdvertisingDetail,
    setActiveSection: input.setActiveSection,
    setError: input.setError,
    setStatusNotice: input.setStatusNotice,
    setIsAdvertisingSyncStarting: input.setIsAdvertisingSyncStarting,
    setProductAdvertisingDateRange: input.setProductAdvertisingDateRange,
    setProductsSortDirection: input.setProductsSortDirection,
    prefetchSavedExport,
    openExport,
  });

  return {
    openExport,
    openMethod,
    prefetchSavedExport,
    prefetchMethodLatestExport,
    openProductsWorkspace,
    prefetchProductsWorkspace,
    handleSaveToken,
    handleClearToken,
    handleRunExport,
    handleRunAdvertisingSync,
    handleReloadSelectedProductAdvertising,
    handleProductHover,
    handleProductFocus,
    handleProductOpen,
    handleBackToProducts,
    handleProductsSortToggle,
  };
}
