import { useCallback, useEffect, useMemo, useState } from "react";

import type { ProductAdvertisingWorkspaceClusterRow } from "../../../api/syncClient";
import { buildAdvertisingClusterGroupKey } from "./clusterTableView";

export function useAdvertisingClusterGroupSelection(
  visibleClusterRows: ProductAdvertisingWorkspaceClusterRow[],
  availableClusterRows: ProductAdvertisingWorkspaceClusterRow[] = visibleClusterRows,
) {
  const [expandedClusterKeys, setExpandedClusterKeys] = useState<string[]>([]);
  const [selectedClusterKeys, setSelectedClusterKeys] = useState<string[]>([]);

  const visibleClusterRowKeys = useMemo(
    () => visibleClusterRows.map((row) => buildAdvertisingClusterGroupKey(row)),
    [visibleClusterRows],
  );
  const selectedClusterKeySet = useMemo(
    () => new Set(selectedClusterKeys),
    [selectedClusterKeys],
  );
  const availableClusterRowKeys = useMemo(
    () => availableClusterRows.map((row) => buildAdvertisingClusterGroupKey(row)),
    [availableClusterRows],
  );
  const selectedClusterRows = useMemo(
    () =>
      visibleClusterRows.filter((row) =>
        selectedClusterKeySet.has(buildAdvertisingClusterGroupKey(row)),
      ),
    [selectedClusterKeySet, visibleClusterRows],
  );

  useEffect(() => {
    setExpandedClusterKeys((currentValue) => {
      const validKeys = new Set(availableClusterRowKeys);
      const filtered = currentValue.filter((item) => validKeys.has(item));
      // Возвращаем оригинальный массив если ничего не убрали — это сохраняет
      // стабильность ссылки и не дёргает зависящие от expandedClusterKeys хуки.
      return filtered.length === currentValue.length ? currentValue : filtered;
    });
  }, [availableClusterRowKeys]);

  useEffect(() => {
    setSelectedClusterKeys((currentValue) => {
      const validKeys = new Set(availableClusterRowKeys);
      const filtered = currentValue.filter((item) => validKeys.has(item));
      return filtered.length === currentValue.length ? currentValue : filtered;
    });
  }, [availableClusterRowKeys]);

  const toggleClusterGroup = useCallback((groupKey: string) => {
    setExpandedClusterKeys((currentValue) =>
      currentValue.includes(groupKey)
        ? currentValue.filter((item) => item !== groupKey)
        : [...currentValue, groupKey],
    );
  }, []);

  const toggleSelectedClusterGroup = useCallback((groupKey: string) => {
    setSelectedClusterKeys((currentValue) =>
      currentValue.includes(groupKey)
        ? currentValue.filter((item) => item !== groupKey)
        : [...currentValue, groupKey],
    );
  }, []);

  const toggleSelectAllClusterGroups = useCallback(() => {
    setSelectedClusterKeys((currentValue) => {
      if (visibleClusterRowKeys.length === 0) {
        return currentValue;
      }

      const currentValueSet = new Set(currentValue);
      const allSelected = visibleClusterRowKeys.every((key) => currentValueSet.has(key));
      if (allSelected) {
        const visibleKeysSet = new Set(visibleClusterRowKeys);
        return currentValue.filter((item) => !visibleKeysSet.has(item));
      }

      return Array.from(new Set([...currentValue, ...visibleClusterRowKeys]));
    });
  }, [visibleClusterRowKeys]);

  const allVisibleClustersSelected =
    visibleClusterRows.length > 0 && selectedClusterRows.length === visibleClusterRows.length;

  return {
    expandedClusterKeys,
    selectedClusterKeys,
    selectedClusterRows,
    allVisibleClustersSelected,
    setSelectedClusterKeys,
    toggleClusterGroup,
    toggleSelectedClusterGroup,
    toggleSelectAllClusterGroups,
  };
}
