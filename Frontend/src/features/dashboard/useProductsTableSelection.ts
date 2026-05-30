import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { ProductListItem } from "./useDashboardProductsWorkspace";

// Колонки-ячейки, которые можно выделять и массово очищать (как в Google Sheets).
// Цена исключена намеренно: это запись на маркетплейс WB, «очистить» её нельзя.
export type EditableColumnKey = "cost" | "targetMargin" | "priceInput";
export const EDITABLE_COLUMN_KEYS: readonly EditableColumnKey[] = ["cost", "targetMargin", "priceInput"];

/** Ключ ячейки в наборе выделения. */
export function cellKey(nmId: number, colKey: EditableColumnKey): string {
  return `${String(nmId)}|${colKey}`;
}

export type EditingCell = { nmId: number; colKey: EditableColumnKey };

type Input = {
  /** Текущий отображаемый (отсортированный) список — для прямоугольного диапазона по строкам. */
  displayProducts: ProductListItem[];
  /** Редактируемые колонки в текущем порядке отображения (для диапазона по столбцам). */
  clearableColumns: EditableColumnKey[];
  /** Ref на контейнер таблицы — клик вне него сбрасывает выделение/правку. */
  tableRef: RefObject<HTMLElement | null>;
  onCostCleared: (nmIds: number[]) => Promise<void>;
  onClearTargetMargins: (nmIds: number[]) => void;
  onClearPriceInputs: (nmIds: number[]) => void;
  onPriceSaved: (nmId: number, targetFinal: number) => Promise<void>;
};

/** Прямоугольный диапазон ячеек от anchor до target по строкам × редактируемым столбцам. */
function rectCells(
  anchor: { row: number; colKey: EditableColumnKey },
  target: { row: number; colKey: EditableColumnKey },
  displayProducts: ProductListItem[],
  clearableColumns: EditableColumnKey[],
): Set<string> {
  const ci = clearableColumns.indexOf(anchor.colKey);
  const cj = clearableColumns.indexOf(target.colKey);
  if (ci < 0 || cj < 0) return new Set();
  const cols = clearableColumns.slice(Math.min(ci, cj), Math.max(ci, cj) + 1);
  const r1 = Math.min(anchor.row, target.row);
  const r2 = Math.max(anchor.row, target.row);
  const set = new Set<string>();
  for (let r = r1; r <= r2; r++) {
    const nmId = displayProducts[r]?.nmId;
    if (nmId === null || nmId === undefined) continue;
    for (const colKey of cols) set.add(cellKey(nmId, colKey));
  }
  return set;
}

/**
 * Выделение ЯЧЕЕК (как в Google Sheets) + inline-редактирование таблицы товаров/юнит-экономики:
 * клик — выделить ячейку, перетаскивание/Shift-клик — прямоугольный диапазон, Ctrl/Cmd-клик —
 * добавить/убрать; Delete/Backspace — массово очистить выделенные редактируемые ячейки (с/с — на
 * бэке, поля калькулятора — локально); двойной клик / Enter / набор цифры — правка активной ячейки;
 * Esc / клик-вне — сброс. Запись цены (WB) — отдельной веткой (editingPriceNmId), не в выделении.
 */
export function useProductsTableSelection({
  displayProducts,
  clearableColumns,
  tableRef,
  onCostCleared,
  onClearTargetMargins,
  onClearPriceInputs,
  onPriceSaved,
}: Input) {
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [editingPriceNmId, setEditingPriceNmId] = useState<number | null>(null);
  // Первый набранный символ для «правки набором» (Sheets) — ячейка стартует с него.
  const [initialEditChar, setInitialEditChar] = useState<string | null>(null);

  const anchorRef = useRef<{ row: number; colKey: EditableColumnKey } | null>(null);
  const draggingRef = useRef(false);
  // Свежие данные для drag/keyboard-хендлеров без пересоздания глобальных слушателей.
  const dataRef = useRef({ displayProducts, clearableColumns });
  useEffect(() => {
    dataRef.current = { displayProducts, clearableColumns };
  }, [displayProducts, clearableColumns]);

  // ── Выделение ячеек ────────────────────────────────────────────────────────
  const onCellMouseDown = useCallback(
    (nmId: number, row: number, colKey: EditableColumnKey, event: React.MouseEvent) => {
      if (event.button !== 0) return;
      // Не даём браузеру начать ВЫДЕЛЕНИЕ ТЕКСТА соседних (read-only) ячеек при
      // перетаскивании рамки — иначе при выделении столбца «подсвечивается всё остальное».
      event.preventDefault();
      if (tableRef.current) tableRef.current.style.userSelect = "none";
      if (event.shiftKey && anchorRef.current) {
        setSelectedCells(
          rectCells(anchorRef.current, { row, colKey }, displayProducts, clearableColumns),
        );
        setEditing(null);
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        const key = cellKey(nmId, colKey);
        setSelectedCells((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
        anchorRef.current = { row, colKey };
        setEditing(null);
        return;
      }
      // Обычный клик: выделить одну ячейку и начать возможное перетаскивание-диапазон.
      anchorRef.current = { row, colKey };
      draggingRef.current = true;
      setSelectedCells(new Set([cellKey(nmId, colKey)]));
      setEditing(null);
      setEditingPriceNmId(null);
    },
    [displayProducts, clearableColumns, tableRef],
  );

  const onCellMouseEnter = useCallback((_nmId: number, row: number, colKey: EditableColumnKey) => {
    if (!draggingRef.current || !anchorRef.current) return;
    const { displayProducts: dp, clearableColumns: cc } = dataRef.current;
    setSelectedCells(rectCells(anchorRef.current, { row, colKey }, dp, cc));
  }, []);

  useEffect(() => {
    const onUp = () => {
      draggingRef.current = false;
      // Возвращаем выделение текста после перетаскивания (чтобы read-only значения
      // по-прежнему можно было выделить/скопировать обычным образом).
      if (tableRef.current) tableRef.current.style.userSelect = "";
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [tableRef]);

  // ── Вход в правку ────────────────────────────────────────────────────────────
  const onCellDoubleClick = useCallback((nmId: number, colKey: EditableColumnKey) => {
    setSelectedCells(new Set([cellKey(nmId, colKey)]));
    anchorRef.current = null;
    setInitialEditChar(null);
    setEditing({ nmId, colKey });
  }, []);

  const onCommitEdit = useCallback(() => {
    setEditing(null);
    setInitialEditChar(null);
  }, []);

  // Стабильный колбэк для карандаша себестоимости (один reference на все ячейки → memo цел).
  const onStartEditCost = useCallback((nmId: number) => {
    setSelectedCells(new Set([cellKey(nmId, "cost")]));
    setEditingPriceNmId(null);
    setInitialEditChar(null);
    setEditing({ nmId, colKey: "cost" });
  }, []);

  // ── Запись цены на WB (отдельно от выделения) ───────────────────────────────
  const onStartPriceEdit = useCallback((nmId: number) => {
    setSelectedCells(new Set());
    setEditing(null);
    setEditingPriceNmId(nmId);
  }, []);
  const onCommitPriceEdit = useCallback(() => setEditingPriceNmId(null), []);

  const [priceConfirm, setPriceConfirm] = useState<{ nmId: number; target: number } | null>(null);
  const onRequestPriceConfirm = useCallback((nmId: number, target: number) => {
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

  // ── Клавиатура (Delete/Esc/Enter/набор) ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // В режиме правки клавиши обрабатывает сам инпут.
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      )
        return;
      if (editing || selectedCells.size === 0) {
        if (e.key === "Escape" && (editing || selectedCells.size > 0)) {
          setSelectedCells(new Set());
          setEditing(null);
          setEditingPriceNmId(null);
          anchorRef.current = null;
        }
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const costIds: number[] = [];
        const marginIds: number[] = [];
        const priceInputIds: number[] = [];
        for (const key of selectedCells) {
          const sep = key.indexOf("|");
          const nmId = Number(key.slice(0, sep));
          const colKey = key.slice(sep + 1);
          if (colKey === "cost") costIds.push(nmId);
          else if (colKey === "targetMargin") marginIds.push(nmId);
          else if (colKey === "priceInput") priceInputIds.push(nmId);
        }
        if (costIds.length > 0) void onCostCleared(costIds);
        if (marginIds.length > 0) onClearTargetMargins(marginIds);
        if (priceInputIds.length > 0) onClearPriceInputs(priceInputIds);
        setSelectedCells(new Set());
        anchorRef.current = null;
      } else if (e.key === "Escape") {
        setSelectedCells(new Set());
        setEditingPriceNmId(null);
        anchorRef.current = null;
      } else if (e.key === "Enter" && selectedCells.size === 1) {
        const [key] = selectedCells;
        if (key === undefined) return;
        const sep = key.indexOf("|");
        e.preventDefault();
        setInitialEditChar(null);
        setEditing({ nmId: Number(key.slice(0, sep)), colKey: key.slice(sep + 1) as EditableColumnKey });
      } else if (
        selectedCells.size === 1 &&
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        /[0-9.,-]/.test(e.key)
      ) {
        // Правка набором: первый символ открывает ячейку и становится началом значения.
        const [key] = selectedCells;
        if (key === undefined) return;
        const sep = key.indexOf("|");
        e.preventDefault();
        setInitialEditChar(e.key === "," ? "." : e.key);
        setEditing({ nmId: Number(key.slice(0, sep)), colKey: key.slice(sep + 1) as EditableColumnKey });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedCells, editing, onCostCleared, onClearTargetMargins, onClearPriceInputs]);

  // ── Клик вне таблицы — сброс ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) {
        setSelectedCells(new Set());
        setEditing(null);
        setEditingPriceNmId(null);
        anchorRef.current = null;
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tableRef]);

  return {
    selectedCells,
    editing,
    editingPriceNmId,
    initialEditChar,
    priceConfirm,
    onCellMouseDown,
    onCellMouseEnter,
    onCellDoubleClick,
    onCommitEdit,
    onStartEditCost,
    onStartPriceEdit,
    onCommitPriceEdit,
    onRequestPriceConfirm,
    handleCancelPriceConfirm,
    handleConfirmPrice,
  };
}
