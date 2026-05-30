import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  COL_ID_IDX,
  COL_NAME_IDX,
  COL_NO_IDX,
  COL_PINNED_IDX,
  MatrixBodyRow,
  MatrixLeftRow,
  MatrixPinnedRow,
  type CellContent,
  type CellMouseHandlers,
  type VisibleCol,
} from "./VirtualMatrixRows";

export type { CellContent } from "./VirtualMatrixRows";

export type DateColumn = {
  /** Stable identifier for keys */
  key: string;
  /** Top header label content */
  headerLabel: ReactNode;
  /** Optional sort handler — wraps the label in a clickable button */
  onHeaderClick?: () => void;
  /** Sort indicator element rendered next to label (when sort is enabled) */
  sortIndicator?: ReactNode;
  /** Content of the "Итого" cell for this column — undefined → empty cell */
  totalDisplay?: ReactNode;
  /** Pinned column ("сегодня"/latest): golden right border, bold gold label */
  accent?: boolean;
};

export type LeadingColumnConfig = {
  width: number;
  setWidth: (w: number) => void;
  minWidth: number;
  headerLabel: ReactNode;
  onHeaderClick?: () => void;
  sortIndicator?: ReactNode;
};

export type VirtualMatrixTableProps = {
  title: string;
  toolbar?: ReactNode;
  onBack: () => void;
  /** When non-null → render this empty-state instead of the grid */
  empty: ReactNode | null;

  rowCount: number;
  getRowKey: (rowIdx: number) => string;
  /** Content for №/ID/Название for a given row */
  getLeftLeading: (rowIdx: number) => {
    no: CellContent;
    id: CellContent;
    name: CellContent;
  };

  /** № column — fixed width, no sort */
  noCol: { width: number; setWidth: (w: number) => void; minWidth: number };
  idCol: LeadingColumnConfig;
  nameCol: LeadingColumnConfig;

  /** Pinned date column (e.g. "Сегодня"/latest). Undefined → no pinned section. */
  pinnedCol?: DateColumn;
  getPinnedCell?: (rowIdx: number) => CellContent;

  /** History date columns (excluding pinned). All share the same width. */
  dataCols: DateColumn[];
  dataColWidth: number;
  setDataColWidth: (w: number) => void;
  dataColMinWidth: number;
  getCell: (rowIdx: number, dataColIdx: number) => CellContent;

  /** Show second header row "Итого" */
  hasTotalsRow: boolean;
};

const ROW_H = 32;
const HEADER_ROW_H = 26;

function ResizeHandle({
  onStart,
}: {
  onStart: (event: React.MouseEvent) => void;
}) {
  return (
    <div
      onMouseDown={onStart}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 6,
        height: "100%",
        cursor: "col-resize",
        zIndex: 5,
        userSelect: "none",
      }}
    />
  );
}

function HeaderButton({
  label,
  onClick,
  sortIndicator,
  accent,
}: {
  label: ReactNode;
  onClick?: () => void;
  sortIndicator?: ReactNode;
  accent?: boolean;
}) {
  const style: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: onClick ? "pointer" : "default",
    padding: 0,
    font: "inherit",
    color: accent ? "var(--wb-gold-dark)" : "inherit",
    fontWeight: accent ? 800 : 700,
    display: "flex",
    alignItems: "center",
    gap: 4,
    width: "100%",
    height: "100%",
    justifyContent: "center",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
  if (!onClick) {
    return (
      <span style={style}>
        {label}
        {sortIndicator}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      style={style}
    >
      {label}
      {sortIndicator}
    </button>
  );
}

const headerCellBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 700,
  boxSizing: "border-box",
  background: "var(--wb-table-header-bg)",
  color: "rgba(15,23,42,0.9)",
  borderBottom: "1px solid rgba(201, 162, 39, 0.3)",
  borderRight: "1px solid rgba(0,0,0,0.04)",
  padding: "0 6px",
  whiteSpace: "nowrap",
  overflow: "hidden",
};

const totalsCellBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  fontWeight: 700,
  boxSizing: "border-box",
  background: "var(--wb-table-totals-bg)",
  color: "rgba(15,23,42,0.6)",
  borderBottom: "1px solid rgba(201, 162, 39, 0.3)",
  borderRight: "1px solid rgba(0,0,0,0.04)",
  padding: "0 6px",
};

function normalizeSelection(
  a: { r: number; c: number },
  b: { r: number; c: number },
) {
  return {
    r1: Math.min(a.r, b.r),
    r2: Math.max(a.r, b.r),
    c1: Math.min(a.c, b.c),
    c2: Math.max(a.c, b.c),
  };
}

export function VirtualMatrixTable(props: VirtualMatrixTableProps) {
  const {
    title,
    toolbar,
    onBack,
    empty,
    rowCount,
    getRowKey,
    getLeftLeading,
    noCol,
    idCol,
    nameCol,
    pinnedCol,
    getPinnedCell,
    dataCols,
    dataColWidth,
    setDataColWidth,
    dataColMinWidth,
    getCell,
    hasTotalsRow,
  } = props;

  const leftFixedW = noCol.width + idCol.width + nameCol.width;
  const pinnedW = pinnedCol ? dataColWidth : 0;
  const HEADER_H = hasTotalsRow ? HEADER_ROW_H * 2 : HEADER_ROW_H;

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const leftColsRef = useRef<HTMLDivElement | null>(null);
  const pinnedBodyRef = useRef<HTMLDivElement | null>(null);
  // Inner refs receive transform updates synced to body scroll
  const headerInnerRef = useRef<HTMLDivElement | null>(null);
  const leftColsInnerRef = useRef<HTMLDivElement | null>(null);
  const pinnedBodyInnerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Track elements that already have a wheel-forward listener attached,
  // so we never attach twice to the same element across re-renders.
  const wheelAttachedRef = useRef<WeakSet<HTMLDivElement>>(new WeakSet());

  const estimateRow = useCallback(() => ROW_H, []);
  const estimateCol = useCallback(() => dataColWidth, [dataColWidth]);

  const rowVirt = useVirtualizer({
    count: rowCount,
    getScrollElement: () => bodyRef.current,
    estimateSize: estimateRow,
    overscan: 8,
  });

  const colVirt = useVirtualizer({
    count: dataCols.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: estimateCol,
    overscan: 4,
    horizontal: true,
  });

  useEffect(() => {
    colVirt.measure();
  }, [dataColWidth, colVirt]);

  const syncMirrors = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const sl = el.scrollLeft;
    const st = el.scrollTop;
    if (headerInnerRef.current) {
      headerInnerRef.current.style.transform = `translate3d(${String(-sl)}px, 0, 0)`;
    }
    if (leftColsInnerRef.current) {
      leftColsInnerRef.current.style.transform = `translate3d(0, ${String(-st)}px, 0)`;
    }
    if (pinnedBodyInnerRef.current) {
      pinnedBodyInnerRef.current.style.transform = `translate3d(0, ${String(-st)}px, 0)`;
    }
  }, []);

  const handleBodyScroll = syncMirrors;

  // Forward wheel events on pinned regions to the body, so user can scroll
  // while hovering header/left-cols/pinned-col. We update transforms in the
  // same handler call (without waiting for the async scroll event) so pinned
  // regions and body never drift visually. Attached via ref callbacks so the
  // listener is wired up the instant the element mounts (even if the pinned
  // section appears later than the rest of the grid).
  const attachWheelForwarder = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      if (wheelAttachedRef.current.has(el)) return;
      wheelAttachedRef.current.add(el);
      el.addEventListener(
        "wheel",
        (e: WheelEvent) => {
          const body = bodyRef.current;
          if (!body) return;
          e.preventDefault();
          body.scrollLeft += e.deltaX;
          body.scrollTop += e.deltaY;
          syncMirrors();
        },
        { passive: false },
      );
    },
    [syncMirrors],
  );

  const setHeaderRef = useCallback(
    (el: HTMLDivElement | null) => {
      headerRef.current = el;
      attachWheelForwarder(el);
    },
    [attachWheelForwarder],
  );

  const setLeftColsRef = useCallback(
    (el: HTMLDivElement | null) => {
      leftColsRef.current = el;
      attachWheelForwarder(el);
    },
    [attachWheelForwarder],
  );

  const setPinnedBodyRef = useCallback(
    (el: HTMLDivElement | null) => {
      pinnedBodyRef.current = el;
      attachWheelForwarder(el);
    },
    [attachWheelForwarder],
  );

  const setBodyRef = useCallback(
    (el: HTMLDivElement | null) => {
      bodyRef.current = el;
      attachWheelForwarder(el);
    },
    [attachWheelForwarder],
  );

  const startResize = useCallback(
    (kind: "no" | "id" | "name" | "data", startW: number) =>
      (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const minW =
          kind === "no"
            ? noCol.minWidth
            : kind === "id"
              ? idCol.minWidth
              : kind === "name"
                ? nameCol.minWidth
                : dataColMinWidth;
        document.body.style.cursor = "col-resize";

        const onMove = (e: MouseEvent) => {
          const delta = e.clientX - startX;
          const next = Math.max(minW, startW + delta);
          if (kind === "no") noCol.setWidth(next);
          else if (kind === "id") idCol.setWidth(next);
          else if (kind === "name") nameCol.setWidth(next);
          else setDataColWidth(next);
        };
        const onUp = () => {
          document.body.style.cursor = "";
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp, { once: true });
      },
    [
      noCol,
      idCol.minWidth,
      nameCol.minWidth,
      dataColMinWidth,
      idCol.setWidth,
      nameCol.setWidth,
      setDataColWidth,
    ],
  );

  // ── Selection state ──────────────────────────────────────────────────────
  // Column indices in selection space:
  //   -3 = №, -2 = ID, -1 = Название, 0 = pinned, k>=1 = dataCols[k-1]
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null);
  const draggingRef = useRef(false);
  // Mirror of `anchor` for the (stable) delegated mousedown handler — lets the
  // handler read the current anchor for shift-extend without depending on state
  // (which would change its identity and bust every memoized row each selection).
  const anchorRef = useRef<{ r: number; c: number } | null>(null);

  const selRect = useMemo(() => {
    if (!anchor || !focus) return null;
    return normalizeSelection(anchor, focus);
  }, [anchor, focus]);

  // Delegated cell handlers — coordinates come from `data-r`/`data-c` on the cell
  // (event.currentTarget), so these stay stable (empty deps) and never allocate a
  // closure per cell. Same event semantics as before (currentTarget is the cell).
  const onCellMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      // Don't start selection from clicks on resize handles or header buttons
      const target = event.target as HTMLElement;
      if (target.closest("button") || target.closest("[data-resize]")) return;
      const el = event.currentTarget;
      const r = Number(el.dataset.r);
      const c = Number(el.dataset.c);
      if (Number.isNaN(r) || Number.isNaN(c)) return;
      event.preventDefault();
      if (event.shiftKey && anchorRef.current) {
        setFocus({ r, c });
      } else {
        const a = { r, c };
        anchorRef.current = a;
        setAnchor(a);
        setFocus(a);
      }
      draggingRef.current = true;
    },
    [],
  );

  const onCellMouseEnter = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const el = event.currentTarget;
      const r = Number(el.dataset.r);
      const c = Number(el.dataset.c);
      if (Number.isNaN(r) || Number.isNaN(c)) return;
      setFocus({ r, c });
    },
    [],
  );

  const cellHandlers = useMemo<CellMouseHandlers>(
    () => ({ onMouseDown: onCellMouseDown, onMouseEnter: onCellMouseEnter }),
    [onCellMouseDown, onCellMouseEnter],
  );

  useEffect(() => {
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ── Auto-scroll while dragging near edges ────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const el = bodyRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const EDGE = 36;
      const SPEED = 12;
      let dx = 0;
      let dy = 0;
      if (e.clientX < rect.left + EDGE) dx = -SPEED;
      else if (e.clientX > rect.right - EDGE) dx = SPEED;
      if (e.clientY < rect.top + EDGE) dy = -SPEED;
      else if (e.clientY > rect.bottom - EDGE) dy = SPEED;
      if (dx !== 0 || dy !== 0) {
        el.scrollBy({ left: dx, top: dy });
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  // ── Cell value lookup for copy ───────────────────────────────────────────
  const getCopyText = useCallback(
    (r: number, c: number): string => {
      if (r < 0 || r >= rowCount) return "";
      if (c === COL_NO_IDX) return String(r + 1);
      if (c === COL_ID_IDX) return getLeftLeading(r).id.copy;
      if (c === COL_NAME_IDX) return getLeftLeading(r).name.copy;
      if (c === COL_PINNED_IDX && pinnedCol && getPinnedCell)
        return getPinnedCell(r).copy;
      if (c >= 1 && c <= dataCols.length) return getCell(r, c - 1).copy;
      return "";
    },
    [rowCount, getLeftLeading, pinnedCol, getPinnedCell, dataCols.length, getCell],
  );

  // ── Copy on Ctrl/Cmd+C ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (e.key !== "c" && e.key !== "C") return;
      if (!selRect) return;
      // Don't hijack copy if user is selecting text in an input/textarea
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      // Skip if the table isn't focused (no anchor means no selection on our grid)
      const containerEl = containerRef.current;
      if (!containerEl || !containerEl.contains(document.activeElement)) {
        // Allow copy even if focus is on body (typical when user dragged to select)
        // — proceed.
      }
      const lines: string[] = [];
      for (let r = selRect.r1; r <= selRect.r2; r++) {
        const parts: string[] = [];
        for (let c = selRect.c1; c <= selRect.c2; c++) {
          parts.push(getCopyText(r, c));
        }
        lines.push(parts.join("\t"));
      }
      const tsv = lines.join("\n");
      void navigator.clipboard.writeText(tsv).catch(() => {
        /* clipboard may be unavailable */
      });
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [selRect, getCopyText]);

  // ── Clear selection on Escape / outside click ────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        anchorRef.current = null;
        setAnchor(null);
        setFocus(null);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        anchorRef.current = null;
        setAnchor(null);
        setFocus(null);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, []);

  const datesAreaW = colVirt.getTotalSize();
  const bodyAreaH = rowVirt.getTotalSize();
  const rowItems = rowVirt.getVirtualItems();
  const colItems = colVirt.getVirtualItems();

  // Selection rect → flat numeric bounds for memoized rows. No selection → an
  // empty range (r1=1,r2=0) that never matches any row index (≥0).
  const selR1 = selRect?.r1 ?? 1;
  const selR2 = selRect?.r2 ?? 0;
  const selC1 = selRect?.c1 ?? 1;
  const selC2 = selRect?.c2 ?? 0;

  // Visible column window + a stable key for it. The key stays constant during
  // pure vertical scroll (same horizontal window + width), so memoized body rows
  // bail out; it changes on horizontal scroll / column resize, re-rendering rows.
  const visibleCols: VisibleCol[] = colItems.map((vc) => ({
    index: vc.index,
    start: vc.start,
    size: vc.size,
  }));
  const colsKey =
    colItems.length > 0
      ? `${String(colItems[0]?.index)}:${String(
          colItems[colItems.length - 1]?.index,
        )}:${String(dataColWidth)}`
      : `empty:${String(dataColWidth)}`;

  // Grid template columns: [left fixed] [pinned?] [dates]
  const gridTemplateColumns = pinnedCol
    ? `${leftFixedW}px ${pinnedW}px 1fr`
    : `${leftFixedW}px 1fr`;

  return (
    <section className="wb-card wb-card--wide">
      <div className="wb-workspace-header wb-workspace-header--products-detail">
        <h2>{title}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {toolbar}
          <button className="wb-secondary-button" type="button" onClick={onBack}>
            ← Назад к товарам
          </button>
        </div>
      </div>

      <div className="wb-products-page">
        <section className="wb-table-section">
          {empty != null ? (
            empty
          ) : (
            <div
              ref={containerRef}
              tabIndex={0}
              style={{
                flex: 1,
                minHeight: 0,
                display: "grid",
                gridTemplateColumns,
                gridTemplateRows: `${HEADER_H}px 1fr`,
                border: "1px solid rgba(0,0,0,0.06)",
                borderRadius: 14,
                overflow: "hidden",
                background: "#fff",
                outline: "none",
              }}
            >
              {/* (1,1) TOP-LEFT corner: №/ID/Название headers (+ Итого label row) */}
              <div
                style={{
                  overflow: "hidden",
                  position: "relative",
                  borderRight: "1px solid rgba(0,0,0,0.06)",
                  background: "var(--wb-table-header-bg)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: noCol.width,
                    height: HEADER_ROW_H,
                    ...headerCellBase,
                  }}
                >
                  №
                </div>
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: noCol.width,
                    width: idCol.width,
                    height: HEADER_ROW_H,
                    ...headerCellBase,
                  }}
                >
                  <HeaderButton
                    label={idCol.headerLabel}
                    onClick={idCol.onHeaderClick}
                    sortIndicator={idCol.sortIndicator}
                  />
                  <span data-resize>
                    <ResizeHandle
                      onStart={startResize("id", idCol.width)}
                    />
                  </span>
                </div>
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: noCol.width + idCol.width,
                    width: nameCol.width,
                    height: HEADER_ROW_H,
                    ...headerCellBase,
                  }}
                >
                  <HeaderButton
                    label={nameCol.headerLabel}
                    onClick={nameCol.onHeaderClick}
                    sortIndicator={nameCol.sortIndicator}
                  />
                  <span data-resize>
                    <ResizeHandle
                      onStart={startResize("name", nameCol.width)}
                    />
                  </span>
                </div>
                {hasTotalsRow && (
                  <div
                    style={{
                      position: "absolute",
                      top: HEADER_ROW_H,
                      left: 0,
                      width: leftFixedW,
                      height: HEADER_ROW_H,
                      ...totalsCellBase,
                      justifyContent: "flex-start",
                      paddingLeft: 12,
                    }}
                  >
                    Итого
                  </div>
                )}
              </div>

              {/* (1,2) PINNED header (when pinnedCol is present) */}
              {pinnedCol && (
                <div
                  style={{
                    overflow: "hidden",
                    position: "relative",
                    borderRight: "2px solid var(--wb-gold-mid)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: pinnedW,
                      height: HEADER_ROW_H,
                      ...headerCellBase,
                    }}
                  >
                    <HeaderButton
                      label={pinnedCol.headerLabel}
                      onClick={pinnedCol.onHeaderClick}
                      sortIndicator={pinnedCol.sortIndicator}
                      accent={pinnedCol.accent}
                    />
                    <span data-resize>
                      <ResizeHandle
                        onStart={startResize("data", dataColWidth)}
                      />
                    </span>
                  </div>
                  {hasTotalsRow && (
                    <div
                      style={{
                        position: "absolute",
                        top: HEADER_ROW_H,
                        left: 0,
                        width: pinnedW,
                        height: HEADER_ROW_H,
                        ...totalsCellBase,
                      }}
                    >
                      {pinnedCol.totalDisplay ?? null}
                    </div>
                  )}
                </div>
              )}

              {/* (1,3) DATES header — horizontal mirror */}
              <div ref={setHeaderRef} style={{ overflow: "hidden", position: "relative" }}>
                <div
                  ref={headerInnerRef}
                  style={{
                    width: datesAreaW,
                    height: HEADER_H,
                    position: "relative",
                    willChange: "transform",
                  }}
                >
                  {colItems.map((vc) => {
                    const col = dataCols[vc.index];
                    if (!col) return null;
                    return (
                      <Fragment key={vc.key}>
                        <div
                          style={{
                            position: "absolute",
                            left: vc.start,
                            top: 0,
                            width: vc.size,
                            height: HEADER_ROW_H,
                            ...headerCellBase,
                          }}
                        >
                          <HeaderButton
                            label={col.headerLabel}
                            onClick={col.onHeaderClick}
                            sortIndicator={col.sortIndicator}
                          />
                        </div>
                        {hasTotalsRow && (
                          <div
                            style={{
                              position: "absolute",
                              left: vc.start,
                              top: HEADER_ROW_H,
                              width: vc.size,
                              height: HEADER_ROW_H,
                              ...totalsCellBase,
                            }}
                          >
                            {col.totalDisplay ?? null}
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
                </div>
              </div>

              {/* (2,1) LEFT fixed cols body — vertical mirror */}
              <div
                ref={setLeftColsRef}
                style={{
                  overflow: "hidden",
                  position: "relative",
                  borderRight: "1px solid rgba(0,0,0,0.06)",
                }}
              >
                <div
                  ref={leftColsInnerRef}
                  style={{
                    width: leftFixedW,
                    height: bodyAreaH,
                    position: "relative",
                    willChange: "transform",
                  }}
                >
                  {rowItems.map((vr) => (
                    <MatrixLeftRow
                      key={getRowKey(vr.index)}
                      rowIndex={vr.index}
                      top={vr.start}
                      rowHeight={vr.size}
                      leftFixedW={leftFixedW}
                      noW={noCol.width}
                      idW={idCol.width}
                      nameW={nameCol.width}
                      getLeftLeading={getLeftLeading}
                      selR1={selR1}
                      selR2={selR2}
                      selC1={selC1}
                      selC2={selC2}
                      handlers={cellHandlers}
                    />
                  ))}
                </div>
              </div>

              {/* (2,2) PINNED body column */}
              {pinnedCol && getPinnedCell && (
                <div
                  ref={setPinnedBodyRef}
                  style={{
                    overflow: "hidden",
                    position: "relative",
                    borderRight: "2px solid var(--wb-gold-mid)",
                  }}
                >
                  <div
                    ref={pinnedBodyInnerRef}
                    style={{
                      width: pinnedW,
                      height: bodyAreaH,
                      position: "relative",
                      willChange: "transform",
                    }}
                  >
                    {rowItems.map((vr) => (
                      <MatrixPinnedRow
                        key={getRowKey(vr.index)}
                        rowIndex={vr.index}
                        top={vr.start}
                        rowHeight={vr.size}
                        pinnedW={pinnedW}
                        getPinnedCell={getPinnedCell}
                        selR1={selR1}
                        selR2={selR2}
                        selC1={selC1}
                        selC2={selC2}
                        handlers={cellHandlers}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* (2,3) MAIN BODY — 2D scrollable */}
              <div
                ref={setBodyRef}
                onScroll={handleBodyScroll}
                style={{
                  overflow: "auto",
                  position: "relative",
                  overscrollBehavior: "contain",
                  willChange: "scroll-position",
                }}
              >
                <div
                  style={{
                    width: datesAreaW,
                    height: bodyAreaH,
                    position: "relative",
                  }}
                >
                  {rowItems.map((vr) => (
                    <MatrixBodyRow
                      key={getRowKey(vr.index)}
                      rowIndex={vr.index}
                      top={vr.start}
                      rowHeight={vr.size}
                      rowWidth={datesAreaW}
                      cols={visibleCols}
                      colsKey={colsKey}
                      getCell={getCell}
                      selR1={selR1}
                      selR2={selR2}
                      selC1={selC1}
                      selC2={selC2}
                      handlers={cellHandlers}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
