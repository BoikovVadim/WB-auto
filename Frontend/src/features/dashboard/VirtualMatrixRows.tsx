import {
  memo,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

/**
 * Мемоизированные строки тела [VirtualMatrixTable](./VirtualMatrixTable.tsx).
 *
 * Вынесены отдельным модулем, чтобы тело таблицы при ВЕРТИКАЛЬНОМ скролле НЕ
 * переотрисовывало все видимые ячейки на каждый кадр: окно колонок (`colsKey`),
 * границы выделения и колбэки стабильны → строки в окне «бейлятся» из reconcile,
 * рендерятся только реально входящие. Тот же приём, что в
 * [ProductsGridRows](./ProductsGridRows.tsx) для таблицы товаров.
 *
 * Координаты выделения читаются делегированными хендлерами из `data-r`/`data-c`
 * на ячейке (а не из per-cell замыканий) — поэтому хендлеры стабильны и не ломают
 * memo. Содержимое ячеек берётся ленивым `getCell`/`getLeftLeading`/`getPinnedCell`
 * — Intl-форматирование вызывается только для входящих в окно строк.
 */

export type CellContent = {
  display: ReactNode;
  /** Plain text for clipboard. Empty string = no value. */
  copy: string;
};

// Column index space for selection:
//  -3 → №,  -2 → ID,  -1 → Название,  0 → pinned (if present),  k ≥ 1 → dataCols[k-1]
export const COL_NO_IDX = -3;
export const COL_ID_IDX = -2;
export const COL_NAME_IDX = -1;
export const COL_PINNED_IDX = 0;

// Selection highlight background (module-level → stable identity for memoized rows).
const SEL_BG = "rgba(56,132,255,0.14)";

const bodyCellBase: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  boxSizing: "border-box",
  background: "#fff",
  borderBottom: "1px solid rgba(0,0,0,0.04)",
  borderRight: "1px solid rgba(0,0,0,0.03)",
  padding: "0 6px",
  cursor: "cell",
  userSelect: "none",
};

const nameCellBase: CSSProperties = {
  ...bodyCellBase,
  justifyContent: "flex-start",
  overflow: "hidden",
  whiteSpace: "nowrap",
};

// Stable delegated cell handlers — read row/col from `data-r`/`data-c` on the cell,
// so we never allocate per-cell closures on every scroll frame (the key to letting
// rows bail out of re-render via memo).
export type CellMouseHandlers = {
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseEnter: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

export type VisibleCol = { index: number; start: number; size: number };

// ── Memoized body row (region 2,3) ─────────────────────────────────────────
// Renders one row's visible data cells. During pure vertical scroll the column
// window (`colsKey`), selection bounds and callbacks are all stable, so staying
// rows bail out of reconciliation — only newly-entering rows render.
type BodyRowProps = {
  rowIndex: number;
  top: number;
  rowHeight: number;
  rowWidth: number;
  cols: VisibleCol[];
  colsKey: string;
  getCell: (rowIdx: number, dataColIdx: number) => CellContent;
  selR1: number;
  selR2: number;
  selC1: number;
  selC2: number;
  handlers: CellMouseHandlers;
};

export const MatrixBodyRow = memo(function MatrixBodyRow(p: BodyRowProps) {
  const rowSelected = p.rowIndex >= p.selR1 && p.rowIndex <= p.selR2;
  return (
    <div
      style={{
        position: "absolute",
        top: p.top,
        left: 0,
        width: p.rowWidth,
        height: p.rowHeight,
        contain: "layout paint",
      }}
    >
      {p.cols.map((vc) => {
        const cell = p.getCell(p.rowIndex, vc.index);
        const selCol = vc.index + 1;
        const sel = rowSelected && selCol >= p.selC1 && selCol <= p.selC2;
        const hasValue = cell.copy !== "";
        return (
          <div
            key={vc.index}
            data-r={p.rowIndex}
            data-c={selCol}
            onMouseDown={p.handlers.onMouseDown}
            onMouseEnter={p.handlers.onMouseEnter}
            style={{
              position: "absolute",
              top: 0,
              left: vc.start,
              width: vc.size,
              height: p.rowHeight,
              ...bodyCellBase,
              fontWeight: hasValue ? 600 : undefined,
              ...(sel ? { background: SEL_BG } : {}),
            }}
          >
            {cell.display}
          </div>
        );
      })}
    </div>
  );
}, areBodyRowEqual);

function areBodyRowEqual(a: BodyRowProps, b: BodyRowProps) {
  return (
    a.rowIndex === b.rowIndex &&
    a.top === b.top &&
    a.rowHeight === b.rowHeight &&
    a.rowWidth === b.rowWidth &&
    a.colsKey === b.colsKey &&
    a.getCell === b.getCell &&
    a.selR1 === b.selR1 &&
    a.selR2 === b.selR2 &&
    a.selC1 === b.selC1 &&
    a.selC2 === b.selC2 &&
    a.handlers === b.handlers
  );
}

// ── Memoized left fixed-columns row (region 2,1): №/ID/Название ─────────────
type LeftRowProps = {
  rowIndex: number;
  top: number;
  rowHeight: number;
  leftFixedW: number;
  noW: number;
  idW: number;
  nameW: number;
  getLeftLeading: (rowIdx: number) => {
    no: CellContent;
    id: CellContent;
    name: CellContent;
  };
  selR1: number;
  selR2: number;
  selC1: number;
  selC2: number;
  handlers: CellMouseHandlers;
};

export const MatrixLeftRow = memo(function MatrixLeftRow(p: LeftRowProps) {
  const leading = p.getLeftLeading(p.rowIndex);
  const rowSelected = p.rowIndex >= p.selR1 && p.rowIndex <= p.selR2;
  const sel = (c: number) => rowSelected && c >= p.selC1 && c <= p.selC2;
  return (
    <div
      style={{
        position: "absolute",
        top: p.top,
        left: 0,
        width: p.leftFixedW,
        height: p.rowHeight,
        contain: "layout paint",
      }}
    >
      <div
        data-r={p.rowIndex}
        data-c={COL_NO_IDX}
        onMouseDown={p.handlers.onMouseDown}
        onMouseEnter={p.handlers.onMouseEnter}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: p.noW,
          height: p.rowHeight,
          ...bodyCellBase,
          color: "rgba(15,23,42,0.5)",
          ...(sel(COL_NO_IDX) ? { background: SEL_BG } : {}),
        }}
      >
        {leading.no.display}
      </div>
      <div
        data-r={p.rowIndex}
        data-c={COL_ID_IDX}
        onMouseDown={p.handlers.onMouseDown}
        onMouseEnter={p.handlers.onMouseEnter}
        style={{
          position: "absolute",
          top: 0,
          left: p.noW,
          width: p.idW,
          height: p.rowHeight,
          ...bodyCellBase,
          ...(sel(COL_ID_IDX) ? { background: SEL_BG } : {}),
        }}
      >
        {leading.id.display}
      </div>
      <div
        data-r={p.rowIndex}
        data-c={COL_NAME_IDX}
        onMouseDown={p.handlers.onMouseDown}
        onMouseEnter={p.handlers.onMouseEnter}
        style={{
          position: "absolute",
          top: 0,
          left: p.noW + p.idW,
          width: p.nameW,
          height: p.rowHeight,
          ...nameCellBase,
          ...(sel(COL_NAME_IDX) ? { background: SEL_BG } : {}),
        }}
      >
        <span
          style={{
            display: "block",
            width: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {leading.name.display}
        </span>
      </div>
    </div>
  );
}, areLeftRowEqual);

function areLeftRowEqual(a: LeftRowProps, b: LeftRowProps) {
  return (
    a.rowIndex === b.rowIndex &&
    a.top === b.top &&
    a.rowHeight === b.rowHeight &&
    a.leftFixedW === b.leftFixedW &&
    a.noW === b.noW &&
    a.idW === b.idW &&
    a.nameW === b.nameW &&
    a.getLeftLeading === b.getLeftLeading &&
    a.selR1 === b.selR1 &&
    a.selR2 === b.selR2 &&
    a.selC1 === b.selC1 &&
    a.selC2 === b.selC2 &&
    a.handlers === b.handlers
  );
}

// ── Memoized pinned column row (region 2,2): «Сегодня»/latest ───────────────
type PinnedRowProps = {
  rowIndex: number;
  top: number;
  rowHeight: number;
  pinnedW: number;
  getPinnedCell: (rowIdx: number) => CellContent;
  selR1: number;
  selR2: number;
  selC1: number;
  selC2: number;
  handlers: CellMouseHandlers;
};

export const MatrixPinnedRow = memo(function MatrixPinnedRow(p: PinnedRowProps) {
  const cell = p.getPinnedCell(p.rowIndex);
  const hasValue = cell.copy !== "";
  const sel =
    p.rowIndex >= p.selR1 &&
    p.rowIndex <= p.selR2 &&
    COL_PINNED_IDX >= p.selC1 &&
    COL_PINNED_IDX <= p.selC2;
  return (
    <div
      data-r={p.rowIndex}
      data-c={COL_PINNED_IDX}
      onMouseDown={p.handlers.onMouseDown}
      onMouseEnter={p.handlers.onMouseEnter}
      style={{
        position: "absolute",
        top: p.top,
        left: 0,
        width: p.pinnedW,
        height: p.rowHeight,
        ...bodyCellBase,
        fontWeight: hasValue ? 600 : undefined,
        contain: "layout paint",
        ...(sel ? { background: SEL_BG } : {}),
      }}
    >
      {cell.display}
    </div>
  );
}, arePinnedRowEqual);

function arePinnedRowEqual(a: PinnedRowProps, b: PinnedRowProps) {
  return (
    a.rowIndex === b.rowIndex &&
    a.top === b.top &&
    a.rowHeight === b.rowHeight &&
    a.pinnedW === b.pinnedW &&
    a.getPinnedCell === b.getPinnedCell &&
    a.selR1 === b.selR1 &&
    a.selR2 === b.selR2 &&
    a.selC1 === b.selC1 &&
    a.selC2 === b.selC2 &&
    a.handlers === b.handlers
  );
}
