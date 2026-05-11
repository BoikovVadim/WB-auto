import { startTransition, useCallback, type Dispatch, type SetStateAction } from "react";

import type { ProductsMode } from "./persistence/dashboardViewState";
import { writeDashboardViewState } from "./persistence/dashboardViewState";

export function useDashboardProductsMode(input: {
  setProductsMode: Dispatch<SetStateAction<ProductsMode>>;
  setSelectedProductNmId: Dispatch<SetStateAction<number | null>>;
  setSelectedCatalogVendorCode: Dispatch<SetStateAction<string | null>>;
}) {
  const { setProductsMode, setSelectedProductNmId, setSelectedCatalogVendorCode } = input;
  const openProductsList = useCallback(() => {
    // Persist list-mode immediately — before startTransition schedules the React
    // re-render and before the async useEffect can fire. This prevents a window
    // where the URL still carries ?productNmId and a refresh would land the user
    // back in the detail view they just navigated away from.
    writeDashboardViewState({
      productsMode: "list",
      selectedProductNmId: null,
      selectedCatalogVendorCode: null,
    });
    startTransition(() => {
      setProductsMode("list");
      setSelectedProductNmId(null);
      setSelectedCatalogVendorCode(null);
    });
  }, [setProductsMode, setSelectedCatalogVendorCode, setSelectedProductNmId]);

  // Direct (urgent) update — no startTransition so the navigation to product
  // detail is synchronous and the user sees the new screen on the very next frame.
  const openProductDetail = useCallback(
    (product: { vendorCode: string; nmId: number | null }) => {
      setProductsMode("detail");
      setSelectedCatalogVendorCode(product.vendorCode);
      setSelectedProductNmId(product.nmId);
    },
    [setProductsMode, setSelectedCatalogVendorCode, setSelectedProductNmId],
  );

  return {
    openProductsList,
    openProductDetail,
  };
}
