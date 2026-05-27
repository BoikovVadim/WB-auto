import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProductAdvertisingWorkspaceClusterRow } from "../../../api/syncClient";
import { buildAdvertisingClusterGroupKey } from "./clusterTableView";

export function useAdvertisingClusterGroupSelection(
  visibleClusterRows: ProductAdvertisingWorkspaceClusterRow[],
  availableClusterRows: ProductAdvertisingWorkspaceClusterRow[] = visibleClusterRows,
  /**
   * Ключ для полного сброса выделения — передаётся при смене товара или кампании.
   * Поиск/фильтрация НЕ должны сбрасывать выделение: пользователь выбирает кластеры
   * в одном поисковом контексте и ожидает, что они остаются выбранными при очистке поиска.
   */
  selectionResetKey?: string | null,
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

  // Свёрнутые кластеры чистим при смене фильтра/поиска — ок, раскрытие теряется при скролле.
  useEffect(() => {
    setExpandedClusterKeys((currentValue) => {
      const validKeys = new Set(availableClusterRowKeys);
      const filtered = currentValue.filter((item) => validKeys.has(item));
      // Возвращаем оригинальный массив если ничего не убрали — это сохраняет
      // стабильность ссылки и не дёргает зависящие от expandedClusterKeys хуки.
      return filtered.length === currentValue.length ? currentValue : filtered;
    });
  }, [availableClusterRowKeys]);

  // Выделение сбрасываем ТОЛЬКО при смене товара/кампании (selectionResetKey), но НЕ
  // при изменении поиска или фильтра: пользователь должен выбрать кластеры, сузить поиск,
  // снять отдельные галочки и после очистки поиска увидеть тот же набор выделенных строк.
  const prevResetKeyRef = useRef(selectionResetKey);
  useEffect(() => {
    if (prevResetKeyRef.current === selectionResetKey) return;
    prevResetKeyRef.current = selectionResetKey;
    setSelectedClusterKeys([]);
  }, [selectionResetKey]);

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

  // Сравниваем по числу УНИКАЛЬНЫХ ключей групп: если две видимые строки делят один
  // ключ, длины массивов завышаются и "выбраны все" срабатывает неверно.
  const allVisibleClustersSelected = useMemo(() => {
    const distinctVisibleKeys = new Set(visibleClusterRowKeys);
    if (distinctVisibleKeys.size === 0) {
      return false;
    }
    let selectedCount = 0;
    for (const key of distinctVisibleKeys) {
      if (selectedClusterKeySet.has(key)) {
        selectedCount += 1;
      }
    }
    return selectedCount === distinctVisibleKeys.size;
  }, [visibleClusterRowKeys, selectedClusterKeySet]);

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
