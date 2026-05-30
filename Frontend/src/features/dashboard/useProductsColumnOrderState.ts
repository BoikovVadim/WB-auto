import { useCallback, useEffect, useMemo, useState } from "react";

import {
  applyStoredProductsColumnOrder,
  moveProductsColumn,
  PRODUCTS_COLUMN_STORAGE_KEY,
  productsTableColumnDefs,
  readStoredProductsColumnOrder,
  writeStoredProductsColumnOrder,
  type ProductsColumnKey,
} from "./productsTableColumns";

export function useProductsColumnOrderState() {
  // Read from localStorage synchronously on first render — otherwise the table
  // briefly renders with the default order and then re-renders with the saved
  // one when the effect fires, which causes a visible column-swap flicker on
  // every remount (e.g. when coming back from a retrospective tab).
  const [savedColumns, setSavedColumns] = useState<ProductsColumnKey[]>(
    () => readStoredProductsColumnOrder(),
  );
  const [draggedColumn, setDraggedColumn] = useState<ProductsColumnKey | null>(null);

  useEffect(() => {
    if (savedColumns.length === 0) return;
    writeStoredProductsColumnOrder(savedColumns);
  }, [savedColumns]);

  const orderedColumns = useMemo(
    () => applyStoredProductsColumnOrder(savedColumns),
    [savedColumns],
  );

  const handleMoveColumn = useCallback(
    (source: ProductsColumnKey, target: ProductsColumnKey) => {
      if (source === target) return;
      setSavedColumns((current) =>
        moveProductsColumn(
          applyStoredProductsColumnOrder(current).map((c) => c.key),
          source,
          target,
        ),
      );
    },
    [],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>, target: ProductsColumnKey) => {
      event.preventDefault();
      if (draggedColumn) handleMoveColumn(draggedColumn, target);
      setDraggedColumn(null);
    },
    [draggedColumn, handleMoveColumn],
  );

  const resolvedColumns =
    orderedColumns.length > 0 ? orderedColumns : productsTableColumnDefs;

  return {
    draggedColumn,
    orderedColumns: resolvedColumns,
    setDraggedColumn,
    handleDrop,
    PRODUCTS_COLUMN_STORAGE_KEY,
  };
}
