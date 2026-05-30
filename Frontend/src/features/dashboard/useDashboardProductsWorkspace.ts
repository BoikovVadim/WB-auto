import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type {
  WbExportResponse,
} from "../../api/syncClient";
import {
  resolveProductAdvertisingSheetRequestInput,
} from "./advertising/useProductAdvertisingRequestInput";
import { useProductAdvertisingPendingSyncPolling } from "./advertising/useProductAdvertisingPendingSyncPolling";
import { completeAdvertisingUxBudget } from "./advertising/advertisingUxBudgets";
import type {
  ProductAdvertisingDetailInvalidationTarget,
  ProductAdvertisingDetailRevisions,
} from "./advertising/productAdvertisingDetailInvalidation";
import { useProductAdvertisingWorkspacePrefetch } from "./advertising/useProductAdvertisingWorkspacePrefetch";
import { useProductWorkspace } from "./advertising/useProductWorkspace";
import type { AdvertisingDateRange } from "./advertising/date";
import { isProductsWorkspaceSection } from "./persistence/dashboardViewStateTypes";
import { useDashboardProductCatalog } from "./useDashboardProductCatalog";
import { useDashboardProductSelection } from "./useDashboardProductSelection";
import { useProductSnapshotTargets } from "./useProductSnapshotTargets";
import { useProductsSnapshotWarmup } from "./useProductsSnapshotWarmup";

type ProductOption = {
  vendorCode: string;
  nmId: number | null;
};

export type ProductListItem = {
  vendorCode: string;
  nmId: number | null;
  subjectName?: string | null;
  categoryName?: string | null;
  campaignCounts?: { total: number; active: number; paused: number; disabled: number };
};

export type ProductListSortKey = "id" | "name" | "category" | "subject" | "total" | "active" | "paused" | "disabled";

export function useDashboardProductsWorkspace(input: {
  activeSection: import("./persistence/dashboardViewStateTypes").DashboardSection;
  productsMode: "list" | "detail";
  currentProductExport: WbExportResponse | null;
  currentExportProducts: ProductOption[];
  productAdvertisingDateRange: AdvertisingDateRange;
  selectedCatalogVendorCode: string | null;
  selectedProductNmId: number | null;
  productsSearch: string;
  productsSortKey: ProductListSortKey;
  productsSortDirection: "asc" | "desc";
  productAdvertisingDetailRevisions: ProductAdvertisingDetailRevisions;
  setError: (value: string | null) => void;
  setSelectedCatalogVendorCode: Dispatch<SetStateAction<string | null>>;
  setSelectedProductNmId: Dispatch<SetStateAction<number | null>>;
  invalidateProductAdvertisingDetail: (
    target?: ProductAdvertisingDetailInvalidationTarget,
  ) => void;
  openProductsList: () => void;
}) {
  const { invalidateProductAdvertisingDetail } = input;
  const isProductsSectionActive =
    input.activeSection === "products" || isProductsWorkspaceSection(input.activeSection);
  const isProductsListActive = isProductsSectionActive && input.productsMode === "list";
  const isProductsDetailActive = isProductsSectionActive && input.productsMode === "detail";
  const {
    productCatalogItems,
    isProductCatalogLoading,
  } = useDashboardProductCatalog({
    active: isProductsSectionActive,
    onError: input.setError,
  });
  const deferredProductsSearch = useDeferredValue(input.productsSearch);
  const sortedProducts = useMemo(() => {
    return [...productCatalogItems].sort((left, right) => {
      let result: number;
      if (input.productsSortKey === "name") {
        // Нормализуем разделители (-_/\) в пробел, чтобы "animal-cage" и "animal cage"
        // сравнивались одинаково. Затем побуквенно:
        //   "animal cage"     < "animal cage 107"  — более короткий префикс первым
        //   "animal cage 107" < "animal cage 12"   — '0' < '2' на 7-й позиции
        const normalize = (s: string) =>
          s.trim().replace(/[-_/\\]+/g, " ").replace(/\s+/g, " ").toLocaleLowerCase("ru");
        result = normalize(left.vendorCode).localeCompare(normalize(right.vendorCode), "ru");
      } else if (input.productsSortKey === "id") {
        result = (left.nmId ?? 0) - (right.nmId ?? 0);
      } else if (input.productsSortKey === "category") {
        const normalize = (s: string) =>
          s.trim().replace(/[-_/\\]+/g, " ").replace(/\s+/g, " ").toLocaleLowerCase("ru");
        result = normalize(left.categoryName ?? "").localeCompare(normalize(right.categoryName ?? ""), "ru");
      } else if (input.productsSortKey === "subject") {
        const normalize = (s: string) =>
          s.trim().replace(/[-_/\\]+/g, " ").replace(/\s+/g, " ").toLocaleLowerCase("ru");
        result = normalize(left.subjectName ?? "").localeCompare(normalize(right.subjectName ?? ""), "ru");
      } else {
        const getCnt = (p: typeof left): number => {
          switch (input.productsSortKey) {
            case "total":    return p.campaignCounts?.total ?? 0;
            case "active":   return p.campaignCounts?.active ?? 0;
            case "paused":   return p.campaignCounts?.paused ?? 0;
            case "disabled": return p.campaignCounts?.disabled ?? 0;
            default:         return 0;
          }
        };
        result = getCnt(left) - getCnt(right);
      }
      return input.productsSortDirection === "asc" ? result : -result;
    });
  }, [input.productsSortKey, input.productsSortDirection, productCatalogItems]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = deferredProductsSearch.trim().toLocaleLowerCase("ru");

    if (!normalizedQuery) {
      return sortedProducts;
    }

    return sortedProducts.filter((product) => {
      if (product.vendorCode.toLocaleLowerCase("ru").includes(normalizedQuery)) {
        return true;
      }
      // Не приводим null к строке "null", иначе запрос "null"/"ul" совпал бы со
      // всеми товарами без nmId.
      if (product.nmId !== null && String(product.nmId).includes(normalizedQuery)) {
        return true;
      }
      return false;
    });
  }, [deferredProductsSearch, sortedProducts]);

  useEffect(() => {
    if (!isProductsListActive) {
      return;
    }

    completeAdvertisingUxBudget("products:list-search");
  }, [filteredProducts, isProductsListActive]);

  const { registerCandidateProductSnapshotNmId } = useProductSnapshotTargets(filteredProducts);
  const productAdvertisingPrefetchRequestInput = useMemo(() => {
    return resolveProductAdvertisingSheetRequestInput({
      currentExport: input.currentProductExport,
      initialProductAdvertisingSheet: null,
      selectedProductNmId: null,
      productAdvertisingDateRange: input.productAdvertisingDateRange,
    });
  }, [input.currentProductExport, input.productAdvertisingDateRange]);

  const { queueCandidateWarmup } = useProductsSnapshotWarmup({
    active: false,
    requestInput: productAdvertisingPrefetchRequestInput,
    visibleNmIds: [],
    backgroundNmIds: [],
  });

  const prefetchCandidateSnapshot = useCallback((_nmId: number | null) => {}, []);

  // Прогреваем воркспейс всех видимых товаров пока пользователь смотрит список —
  // чтобы при клике данные брались из кэша моментально без состояния загрузки.
  const visibleFirstNmIds = useMemo(
    () => filteredProducts
      .slice(0, 30)
      .map((p) => p.nmId)
      .filter((id): id is number => id !== null && id > 0),
    [filteredProducts],
  );
  useProductAdvertisingWorkspacePrefetch({
    active: isProductsListActive,
    requestInput: productAdvertisingPrefetchRequestInput,
    visibleNmIds: visibleFirstNmIds,
  });

  const { resolvedCatalogProduct } = useDashboardProductSelection({
    enabled: isProductsDetailActive,
    fixedProducts: productCatalogItems,
    currentExportProducts: input.currentExportProducts,
    selectedCatalogVendorCode: input.selectedCatalogVendorCode,
    selectedProductNmId: input.selectedProductNmId,
    setSelectedCatalogVendorCode: input.setSelectedCatalogVendorCode,
    setSelectedProductNmId: input.setSelectedProductNmId,
  });
  const [stickyDetailProduct, setStickyDetailProduct] = useState<ProductOption | null>(null);
  useEffect(() => {
    if (input.productsMode !== "detail") {
      setStickyDetailProduct(null);
      return;
    }

    if (resolvedCatalogProduct) {
      setStickyDetailProduct(resolvedCatalogProduct);
      return;
    }

    if (input.selectedCatalogVendorCode !== null || input.selectedProductNmId !== null) {
      setStickyDetailProduct({
        vendorCode: input.selectedCatalogVendorCode ?? stickyDetailProduct?.vendorCode ?? "",
        nmId: input.selectedProductNmId,
      });
    }
  }, [
    input.productsMode,
    input.selectedCatalogVendorCode,
    input.selectedProductNmId,
    resolvedCatalogProduct,
    stickyDetailProduct?.vendorCode,
  ]);
  const selectedDetailProduct = useMemo(() => {
    if (input.activeSection !== "products" || input.productsMode !== "detail") {
      return null;
    }

    if (resolvedCatalogProduct) {
      return resolvedCatalogProduct;
    }

    if (input.selectedCatalogVendorCode !== null || input.selectedProductNmId !== null) {
      return {
        vendorCode: input.selectedCatalogVendorCode ?? "",
        nmId: input.selectedProductNmId,
      };
    }

    return stickyDetailProduct;
  }, [
    input.activeSection,
    input.productsMode,
    input.selectedCatalogVendorCode,
    input.selectedProductNmId,
    resolvedCatalogProduct,
    stickyDetailProduct,
  ]);
  const productAdvertisingSheetRequestInput = useMemo(() => {
    if (!isProductsDetailActive || !selectedDetailProduct) {
      return null;
    }

    return resolveProductAdvertisingSheetRequestInput({
      currentExport: input.currentProductExport,
      initialProductAdvertisingSheet: null,
      selectedProductNmId: selectedDetailProduct.nmId,
      productAdvertisingDateRange: input.productAdvertisingDateRange,
    });
  }, [
    input.currentProductExport,
    input.productAdvertisingDateRange,
    isProductsDetailActive,
    selectedDetailProduct,
  ]);

  const {
    productAdvertisingWorkspace,
    productAdvertisingWorkspaceError,
    isProductAdvertisingWorkspaceLoading,
  } = useProductWorkspace({
    active: isProductsDetailActive,
    nmId: selectedDetailProduct?.nmId ?? null,
    requestInput: productAdvertisingSheetRequestInput,
    refreshKey: input.productAdvertisingDetailRevisions.workspace,
  });
  const handlePendingWorkspaceRefresh = useCallback(() => {
    invalidateProductAdvertisingDetail("workspace");
  }, [invalidateProductAdvertisingDetail]);

  const hasPendingClusterSync =
    productAdvertisingWorkspace?.syncState.hasPendingClusterSync ?? false;
  const prevHasPendingClusterSyncRef = useRef(hasPendingClusterSync);

  // When hasPendingClusterSync transitions true → false it means the bid has been
  // confirmed (or failed) on WB. Refresh the cluster table so the checkmark (✓)
  // updates to the confirmed status without waiting for the next manual action.
  useEffect(() => {
    const prev = prevHasPendingClusterSyncRef.current;
    prevHasPendingClusterSyncRef.current = hasPendingClusterSync;
    if (prev && !hasPendingClusterSync && isProductsDetailActive) {
      invalidateProductAdvertisingDetail("table");
    }
  }, [hasPendingClusterSync, invalidateProductAdvertisingDetail, isProductsDetailActive]);

  useProductAdvertisingPendingSyncPolling({
    active: isProductsDetailActive,
    hasPendingSync: hasPendingClusterSync,
    onRefresh: handlePendingWorkspaceRefresh,
  });

  return {
    productCatalogItems,
    isProductCatalogLoading,
    filteredProducts,
    resolvedCatalogProduct: selectedDetailProduct,
    registerCandidateProductSnapshotNmId,
    queueCandidateWarmup,
    prefetchCandidateSnapshot,
    productAdvertisingSheetRequestInput,
    productAdvertisingWorkspace,
    productAdvertisingWorkspaceError,
    isProductAdvertisingWorkspaceLoading,
  };
}
