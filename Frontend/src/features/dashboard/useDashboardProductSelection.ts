import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";

export interface DashboardCatalogProductSelection {
  vendorCode: string;
  nmId: number | null;
}

export function useDashboardProductSelection<TFixedProduct extends DashboardCatalogProductSelection>(input: {
  enabled: boolean;
  fixedProducts: TFixedProduct[];
  currentExportProducts: DashboardCatalogProductSelection[];
  selectedCatalogVendorCode: string | null;
  selectedProductNmId: number | null;
  setSelectedCatalogVendorCode: Dispatch<SetStateAction<string | null>>;
  setSelectedProductNmId: Dispatch<SetStateAction<number | null>>;
}) {
  const {
    enabled,
    fixedProducts,
    currentExportProducts,
    selectedCatalogVendorCode,
    selectedProductNmId,
    setSelectedCatalogVendorCode,
    setSelectedProductNmId,
  } = input;
  const selectedCatalogProduct = useMemo(() => {
    if (!enabled) {
      return null;
    }

    if (selectedProductNmId !== null) {
      const productMatchedByNmId =
        fixedProducts.find((product) => product.nmId === selectedProductNmId) ?? null;
      if (productMatchedByNmId) {
        if (
          !selectedCatalogVendorCode ||
          productMatchedByNmId.vendorCode === selectedCatalogVendorCode
        ) {
          return productMatchedByNmId;
        }

        return (
          fixedProducts.find(
            (product) =>
              product.nmId === selectedProductNmId &&
              product.vendorCode === selectedCatalogVendorCode,
          ) ?? productMatchedByNmId
        );
      }
    }

    if (selectedCatalogVendorCode) {
      return (
        fixedProducts.find((product) => product.vendorCode === selectedCatalogVendorCode) ??
        null
      );
    }

    return null;
  }, [enabled, fixedProducts, selectedCatalogVendorCode, selectedProductNmId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (selectedProductNmId === null) {
      return;
    }

    const matchedProductByNmId =
      currentExportProducts.find((product) => product.nmId === selectedProductNmId) ?? null;
    if (
      matchedProductByNmId &&
      matchedProductByNmId.vendorCode &&
      matchedProductByNmId.vendorCode !== selectedCatalogVendorCode
    ) {
      setSelectedCatalogVendorCode(matchedProductByNmId.vendorCode);
      return;
    }
  }, [
    currentExportProducts,
    enabled,
    selectedCatalogVendorCode,
    selectedProductNmId,
    setSelectedCatalogVendorCode,
  ]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (!selectedCatalogVendorCode || selectedProductNmId !== null) {
      return;
    }

    const matchedProduct = currentExportProducts.find(
      (product) => product.vendorCode === selectedCatalogVendorCode,
    );
    if (
      !matchedProduct ||
      matchedProduct.nmId === null ||
      matchedProduct.nmId === selectedProductNmId
    ) {
      return;
    }

    setSelectedProductNmId(matchedProduct.nmId);
  }, [
    currentExportProducts,
    enabled,
    selectedCatalogVendorCode,
    selectedProductNmId,
    setSelectedProductNmId,
  ]);

  return {
    resolvedCatalogProduct: selectedCatalogProduct,
  };
}
