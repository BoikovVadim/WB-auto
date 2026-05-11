import { useCallback, useEffect, useMemo, useState } from "react";

import {
  advertisingClusterTableColumns,
  advertisingColumnOrderStorageKey,
  applyStoredAdvertisingColumnOrder,
  moveAdvertisingColumn,
  readStoredAdvertisingColumnOrder,
  writeStoredAdvertisingColumnOrder,
} from "./clusterTableView";
import type { AdvertisingClusterSortKey } from "./advertisingTableTypes";

export function useAdvertisingClusterColumnOrderState() {
  const [savedAdvertisingColumns, setSavedAdvertisingColumns] = useState<
    AdvertisingClusterSortKey[]
  >([]);
  const [draggedAdvertisingColumn, setDraggedAdvertisingColumn] =
    useState<AdvertisingClusterSortKey | null>(null);

  useEffect(() => {
    setSavedAdvertisingColumns(
      readStoredAdvertisingColumnOrder(
        advertisingColumnOrderStorageKey,
        advertisingClusterTableColumns.map((column) => column.key),
      ),
    );
  }, []);

  useEffect(() => {
    if (savedAdvertisingColumns.length === 0) {
      return;
    }

    writeStoredAdvertisingColumnOrder(
      advertisingColumnOrderStorageKey,
      savedAdvertisingColumns,
    );
  }, [savedAdvertisingColumns]);

  const orderedAdvertisingColumns = useMemo(
    () =>
      applyStoredAdvertisingColumnOrder(
        advertisingClusterTableColumns,
        savedAdvertisingColumns,
      ),
    [savedAdvertisingColumns],
  );

  const handleMoveAdvertisingColumn = useCallback(
    (sourceColumn: AdvertisingClusterSortKey, targetColumn: AdvertisingClusterSortKey) => {
      if (sourceColumn === targetColumn) {
        return;
      }

      setSavedAdvertisingColumns((currentColumns) =>
        moveAdvertisingColumn(
          applyStoredAdvertisingColumnOrder(
            advertisingClusterTableColumns,
            currentColumns,
          ).map((column) => column.key),
          sourceColumn,
          targetColumn,
        ),
      );
    },
    [],
  );

  const handleAdvertisingColumnDrop = useCallback(
    (
      event: React.DragEvent<HTMLTableCellElement>,
      targetColumn: AdvertisingClusterSortKey,
    ) => {
      event.preventDefault();

      if (draggedAdvertisingColumn) {
        handleMoveAdvertisingColumn(draggedAdvertisingColumn, targetColumn);
      }

      setDraggedAdvertisingColumn(null);
    },
    [draggedAdvertisingColumn, handleMoveAdvertisingColumn],
  );

  return {
    draggedAdvertisingColumn,
    orderedAdvertisingColumns,
    setDraggedAdvertisingColumn,
    handleAdvertisingColumnDrop,
  };
}
