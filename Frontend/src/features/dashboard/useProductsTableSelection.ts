import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { ProductsColumnKey } from "./productsTableColumns";
import type { ProductListItem } from "./useDashboardProductsWorkspace";

// Колонки-ячейки, которые можно РЕДАКТИРОВАТЬ и массово очищать (как в Google Sheets).
// Выделять и копировать можно ЛЮБЫЕ ячейки; править/чистить — только эти.
export type EditableColumnKey = "cost" | "targetMargin" | "priceInput";
export const EDITABLE_COLUMN_KEYS: readonly EditableColumnKey[] = ["cost", "targetMargin", "priceInput"];

function isEditableColumn(colKey: ProductsColumnKey): colKey is EditableColumnKey {
  return (EDITABLE_COLUMN_KEYS as readonly string[]).includes(colKey);
}

/** Ключ ячейки в наборе выделения. */
export function cellKey(nmId: number, colKey: ProductsColumnKey): string {
  return `${String(nmId)}|${colKey}`;
}

export type EditingCell = { nmId: number; colKey: EditableColumnKey };

type Input = {
  /** Текущий отображаемый (отсортированный) список — для диапазона по строкам и копирования. */
  displayProducts: ProductListItem[];
  /** ВСЕ видимые колонки в текущем порядке — для прямоугольного диапазона и TSV-копирования. */
  allColumns: ProductsColumnKey[];
  /** Правка/очистка доступны только в «Юнит Экономике». В «Товарах» — лишь выделение и копирование. */
  editable: boolean;
  /** Ref на контейнер таблицы — клик вне сбрасывает выделение; на нём гасим выделение текста при drag. */
  tableRef: RefObject<HTMLElement | null>;
  /** Значение ячейки «как есть» для буфера обмена (деньги/проценты — без ₽/%, целые — String). */
  getCopyValue: (nmId: number, colKey: ProductsColumnKey) => string;
  onCostCleared: (nmIds: number[]) => Promise<void>;
  onClearTargetMargins: (nmIds: number[]) => void;
  onClearPriceInputs: (nmIds: number[]) => void;
  onPriceSaved: (nmId: number, targetFinal: number) => Promise<void>;
};

/** Прямоугольный диапазон ячеек от anchor до target по строкам × столбцам (весь набор колонок). */
function rectCells(
  anchor: { row: number; colKey: ProductsColumnKey },
  target: { row: number; colKey: ProductsColumnKey },
  displayProducts: ProductListItem[],
  allColumns: ProductsColumnKey[],
): Set<string> {
  const ci = allColumns.indexOf(anchor.colKey);
  const cj = allColumns.indexOf(target.colKey);
  if (ci < 0 || cj < 0) return new Set();
  const cols = allColumns.slice(Math.min(ci, cj), Math.max(ci, cj) + 1);
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
 * Выделение ЯЧЕЕК и работа с таблицей как в Google Sheets: клик — выделить ячейку,
 * перетаскивание/Shift-клик — прямоугольный диапазон (любые колонки, в т.ч. read-only),
 * Ctrl/Cmd-клик — добавить/убрать. **Ctrl/Cmd+C** — копировать диапазон в буфер (TSV,
 * вставляется в Excel/Sheets). **Delete/Backspace** — очистить выделенные РЕДАКТИРУЕМЫЕ
 * ячейки (с/с — на бэке, поля калькулятора — локально; read-only игнорятся). Правка
 * редактируемой ячейки — двойной клик / Enter / набор. Esc / клик-вне — сброс. Запись
 * цены (WB) — отдельной веткой (editingPriceNmId).
 */
export function useProductsTableSelection({
  displayProducts,
  allColumns,
  editable,
  tableRef,
  getCopyValue,
  onCostCleared,
  onClearTargetMargins,
  onClearPriceInputs,
  onPriceSaved,
}: Input) {
  const editableRef = useRef(editable);
  useEffect(() => {
    editableRef.current = editable;
  }, [editable]);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [editingPriceNmId, setEditingPriceNmId] = useState<number | null>(null);
  // Первый набранный символ для «правки набором» (Sheets) — ячейка стартует с него.
  const [initialEditChar, setInitialEditChar] = useState<string | null>(null);

  const anchorRef = useRef<{ row: number; colKey: ProductsColumnKey } | null>(null);
  const draggingRef = useRef(false);
  // Свежие данные для drag/keyboard-хендлеров без пересоздания глобальных слушателей.
  const dataRef = useRef({ displayProducts, allColumns, getCopyValue });
  useEffect(() => {
    dataRef.current = { displayProducts, allColumns, getCopyValue };
  }, [displayProducts, allColumns, getCopyValue]);

  // ── Выделение ячеек ────────────────────────────────────────────────────────
  const onCellMouseDown = useCallback(
    (nmId: number, row: number, colKey: ProductsColumnKey, event: React.MouseEvent) => {
      if (event.button !== 0) return;
      // Не даём браузеру начать ВЫДЕЛЕНИЕ ТЕКСТА при перетаскивании рамки.
      event.preventDefault();
      if (tableRef.current) tableRef.current.style.userSelect = "none";
      if (event.shiftKey && anchorRef.current) {
        setSelectedCells(rectCells(anchorRef.current, { row, colKey }, displayProducts, allColumns));
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
      anchorRef.current = { row, colKey };
      draggingRef.current = true;
      setSelectedCells(new Set([cellKey(nmId, colKey)]));
      setEditing(null);
      setEditingPriceNmId(null);
    },
    [displayProducts, allColumns, tableRef],
  );

  const onCellMouseEnter = useCallback((_nmId: number, row: number, colKey: ProductsColumnKey) => {
    if (!draggingRef.current || !anchorRef.current) return;
    const { displayProducts: dp, allColumns: ac } = dataRef.current;
    setSelectedCells(rectCells(anchorRef.current, { row, colKey }, dp, ac));
  }, []);

  useEffect(() => {
    const onUp = () => {
      draggingRef.current = false;
      if (tableRef.current) tableRef.current.style.userSelect = "";
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [tableRef]);

  // ── Вход в правку (только редактируемые колонки) ─────────────────────────────
  const onCellDoubleClick = useCallback((nmId: number, colKey: ProductsColumnKey) => {
    if (!editableRef.current || !isEditableColumn(colKey)) return;
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

  // Стабильный колбэк для карандаша полей-вводов калькулятора (целевая маржа / цена).
  const onStartEditCalc = useCallback((nmId: number, colKey: EditableColumnKey) => {
    setSelectedCells(new Set([cellKey(nmId, colKey)]));
    setEditingPriceNmId(null);
    setInitialEditChar(null);
    setEditing({ nmId, colKey });
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

  // ── Копирование выделенного диапазона в буфер (TSV) ─────────────────────────
  const copySelection = useCallback(() => {
    const { displayProducts: dp, allColumns: ac, getCopyValue: copy } = dataRef.current;
    const rowOf = new Map<number, number>();
    dp.forEach((p, i) => {
      if (p.nmId !== null) rowOf.set(p.nmId, i);
    });
    let r1 = Infinity;
    let r2 = -Infinity;
    let c1 = Infinity;
    let c2 = -Infinity;
    for (const key of selectedCells) {
      const sep = key.indexOf("|");
      const nmId = Number(key.slice(0, sep));
      const colKey = key.slice(sep + 1) as ProductsColumnKey;
      const r = rowOf.get(nmId);
      const c = ac.indexOf(colKey);
      if (r === undefined || c < 0) continue;
      if (r < r1) r1 = r;
      if (r > r2) r2 = r;
      if (c < c1) c1 = c;
      if (c > c2) c2 = c;
    }
    if (r1 === Infinity) return;
    const lines: string[] = [];
    for (let r = r1; r <= r2; r++) {
      const nmId = dp[r]?.nmId ?? null;
      const cols: string[] = [];
      for (let c = c1; c <= c2; c++) {
        const colKey = ac[c];
        cols.push(
          nmId !== null && colKey !== undefined && selectedCells.has(cellKey(nmId, colKey))
            ? copy(nmId, colKey)
            : "",
        );
      }
      lines.push(cols.join("\t"));
    }
    void navigator.clipboard?.writeText(lines.join("\n")).catch(() => {
      /* буфер недоступен (нет https/прав) — молча игнорируем */
    });
  }, [selectedCells]);

  // ── Клавиатура (Ctrl/Cmd+C / Delete / Esc / Enter / набор) ──────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // В режиме правки/фокуса инпута клавиши обрабатывает сам инпут.
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      )
        return;
      if (editing) return;
      if (selectedCells.size === 0) return;

      // Ctrl/Cmd+C — копировать диапазон (e.code, чтобы работало и на кириллической раскладке).
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyC") {
        e.preventDefault();
        copySelection();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (!editable) return; // в «Товарах» очищать нечего (с/с read-only, калькулятор скрыт)
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
      } else if (editable && e.key === "Enter" && selectedCells.size === 1) {
        const [key] = selectedCells;
        if (key === undefined) return;
        const sep = key.indexOf("|");
        const colKey = key.slice(sep + 1) as ProductsColumnKey;
        if (!isEditableColumn(colKey)) return;
        e.preventDefault();
        setInitialEditChar(null);
        setEditing({ nmId: Number(key.slice(0, sep)), colKey });
      } else if (
        editable &&
        selectedCells.size === 1 &&
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        /[0-9.,-]/.test(e.key)
      ) {
        const [key] = selectedCells;
        if (key === undefined) return;
        const sep = key.indexOf("|");
        const colKey = key.slice(sep + 1) as ProductsColumnKey;
        if (!isEditableColumn(colKey)) return;
        e.preventDefault();
        setInitialEditChar(e.key === "," ? "." : e.key);
        setEditing({ nmId: Number(key.slice(0, sep)), colKey });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedCells, editing, editable, copySelection, onCostCleared, onClearTargetMargins, onClearPriceInputs]);

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
    onStartEditCalc,
    onStartPriceEdit,
    onCommitPriceEdit,
    onRequestPriceConfirm,
    handleCancelPriceConfirm,
    handleConfirmPrice,
  };
}
