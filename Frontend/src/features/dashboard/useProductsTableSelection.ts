import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { ProductListItem } from "./useDashboardProductsWorkspace";

type Input = {
  /** Текущий отображаемый (отсортированный) список — нужен для Shift-диапазона. */
  displayProducts: ProductListItem[];
  /** Ref на <table> — клик вне неё сбрасывает выделение/правку. */
  tableRef: RefObject<HTMLTableElement | null>;
  onCostCleared: (nmIds: number[]) => Promise<void>;
  onPriceSaved: (nmId: number, targetFinal: number) => Promise<void>;
};

/**
 * Состояние и хендлеры выделения строк + inline-редактирования таблицы товаров:
 * мульти-выделение (Ctrl/Cmd-toggle, Shift-диапазон), правка себестоимости и цены,
 * модалка подтверждения цены, клавиатура (Delete/Escape/Enter) и клик-вне. Вынесено
 * из DashboardCatalogProductsSection без изменения поведения (регресс-чек-лист таблицы).
 */
export function useProductsTableSelection({ displayProducts, tableRef, onCostCleared, onPriceSaved }: Input) {
  const [selectedNmIds, setSelectedNmIds] = useState<Set<number>>(new Set());
  const [editingNmId, setEditingNmId] = useState<number | null>(null);
  const [editingPriceNmId, setEditingPriceNmId] = useState<number | null>(null);
  const lastClickedIndexRef = useRef<number>(-1);

  const handleCommitEdit = useCallback(() => {
    setEditingNmId(null);
  }, []);

  // Стабильный колбэк для карандаша: сбрасываем выделение и входим в редактирование
  // конкретной строки. Один и тот же reference на все ячейки — memo не ломается.
  const handleStartEdit = useCallback((nmId: number) => {
    setSelectedNmIds(new Set());
    setEditingPriceNmId(null);
    setEditingNmId(nmId);
  }, []);

  // Редактирование цены (отправка на WB) — отдельно от себестоимости.
  const handleStartPriceEdit = useCallback((nmId: number) => {
    setSelectedNmIds(new Set());
    setEditingNmId(null);
    setEditingPriceNmId(nmId);
  }, []);
  const handleCommitPriceEdit = useCallback(() => {
    setEditingPriceNmId(null);
  }, []);

  // Модалка подтверждения цены: открывается после Enter в поле.
  const [priceConfirm, setPriceConfirm] = useState<{ nmId: number; target: number } | null>(null);
  const handleRequestPriceConfirm = useCallback((nmId: number, target: number) => {
    setEditingPriceNmId(null);
    setPriceConfirm({ nmId, target });
  }, []);
  const handleCancelPriceConfirm = useCallback(() => setPriceConfirm(null), []);
  const handleConfirmPrice = useCallback(async () => {
    if (!priceConfirm) return;
    const { nmId, target } = priceConfirm;
    setPriceConfirm(null);
    await onPriceSaved(nmId, target);
  }, [priceConfirm, onPriceSaved]);

  const handleCellClick = useCallback(
    (nmId: number, index: number, event: React.MouseEvent) => {
      if ((event.target as HTMLElement).tagName === "INPUT") return;

      if (event.ctrlKey || event.metaKey) {
        setSelectedNmIds((prev) => {
          const next = new Set(prev);
          if (next.has(nmId)) next.delete(nmId);
          else next.add(nmId);
          return next;
        });
        lastClickedIndexRef.current = index;
        setEditingNmId(null);
      } else if (event.shiftKey && lastClickedIndexRef.current >= 0) {
        const from = Math.min(lastClickedIndexRef.current, index);
        const to = Math.max(lastClickedIndexRef.current, index);
        setSelectedNmIds(() => {
          const next = new Set<number>();
          for (let i = from; i <= to; i++) {
            const p = displayProducts[i];
            if (p?.nmId !== null && p?.nmId !== undefined) next.add(p.nmId);
          }
          return next;
        });
        setEditingNmId(null);
      } else if (selectedNmIds.size > 0) {
        setSelectedNmIds(new Set([nmId]));
        lastClickedIndexRef.current = index;
        setEditingNmId(null);
      } else {
        setSelectedNmIds(new Set());
        lastClickedIndexRef.current = index;
        setEditingNmId(nmId);
      }
    },
    [selectedNmIds, displayProducts],
  );

  const handleCellDoubleClick = useCallback((nmId: number, index: number) => {
    setSelectedNmIds(new Set());
    lastClickedIndexRef.current = index;
    setEditingNmId(nmId);
  }, []);

  // ── Keyboard handler ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) return;

      if ((e.key === "Delete" || e.key === "Backspace") && selectedNmIds.size > 0) {
        e.preventDefault();
        const ids = Array.from(selectedNmIds);
        void onCostCleared(ids).then(() => {
          setSelectedNmIds(new Set());
        });
      } else if (e.key === "Escape") {
        setSelectedNmIds(new Set());
        setEditingNmId(null);
        setEditingPriceNmId(null);
      } else if (e.key === "Enter" && selectedNmIds.size === 1) {
        const [id] = selectedNmIds;
        if (id !== undefined) {
          setSelectedNmIds(new Set());
          setEditingNmId(id);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedNmIds, onCostCleared]);

  // Click outside clears selection
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) {
        setSelectedNmIds(new Set());
        setEditingNmId(null);
        setEditingPriceNmId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tableRef]);

  return {
    selectedNmIds,
    editingNmId,
    editingPriceNmId,
    priceConfirm,
    handleCommitEdit,
    handleStartEdit,
    handleStartPriceEdit,
    handleCommitPriceEdit,
    handleRequestPriceConfirm,
    handleCancelPriceConfirm,
    handleConfirmPrice,
    handleCellClick,
    handleCellDoubleClick,
  };
}
