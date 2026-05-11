import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import type { WbRawTable } from "../../api/syncClient";
import { ui } from "./copy";
import {
  applyStoredRawColumnOrder,
  formatRawCellValue,
  formatRawColumnLabel,
  getDerivedRawTableState,
  getRawTableColumnClass,
  getRawTableOrderStorageKey,
  isNumericTableValue,
  matchesRawTableSearch,
  moveRawColumn,
  readStoredRawColumnOrder,
  writeStoredRawColumnOrder,
} from "./rawTable";

export function WbRawTableSection(props: { table: WbRawTable; cacheKey: string }) {
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const derivedTableState = useMemo(
    () => getDerivedRawTableState(props.cacheKey, props.table),
    [props.cacheKey, props.table],
  );
  const flattenedRows = derivedTableState.flattenedRows;
  const detectedColumns = derivedTableState.detectedColumns;
  const storageKey = useMemo(
    () => getRawTableOrderStorageKey(props.table.id),
    [props.table.id],
  );
  const [savedColumns, setSavedColumns] = useState<string[]>([]);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const scrollTopRef = useRef(0);
  const scrollRafRef = useRef(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  const handleScroll = useCallback((value: number) => {
    scrollTopRef.current = value;
    cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      setScrollTop(scrollTopRef.current);
    });
  }, []);
  const columns = useMemo(
    () => applyStoredRawColumnOrder(detectedColumns, savedColumns),
    [detectedColumns, savedColumns],
  );
  const filteredRows = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase("ru");

    if (!normalizedQuery) {
      return flattenedRows;
    }

    return flattenedRows.filter((row) => matchesRawTableSearch(row, normalizedQuery));
  }, [flattenedRows, searchQuery]);
  const rowHeight = 24;
  const overscanRows = 8;
  const visibleRowCount = Math.max(
    1,
    Math.ceil(viewportHeight / rowHeight) + overscanRows * 2,
  );
  const startRowIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
  const endRowIndex = Math.min(filteredRows.length, startRowIndex + visibleRowCount);
  const visibleRows = useMemo(
    () => filteredRows.slice(startRowIndex, endRowIndex),
    [filteredRows, startRowIndex, endRowIndex],
  );
  const topSpacerHeight = startRowIndex * rowHeight;
  const bottomSpacerHeight = Math.max(0, (filteredRows.length - endRowIndex) * rowHeight);

  useEffect(() => {
    setSavedColumns(readStoredRawColumnOrder(storageKey, detectedColumns));
  }, [storageKey, detectedColumns]);

  useEffect(() => {
    if (savedColumns.length === 0) {
      return;
    }

    writeStoredRawColumnOrder(storageKey, savedColumns);
  }, [storageKey, savedColumns]);

  useEffect(() => {
    const element = tableWrapRef.current;
    if (!element) {
      return;
    }

    const updateViewportHeight = () => {
      setViewportHeight(element.clientHeight || 480);
    };

    updateViewportHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      updateViewportHeight();
    });
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, [filteredRows.length]);

  useEffect(() => {
    setScrollTop(0);
    if (tableWrapRef.current) {
      tableWrapRef.current.scrollTop = 0;
    }
  }, [searchQuery, props.cacheKey]);

  function handleMoveColumn(sourceColumn: string, targetColumn: string) {
    if (sourceColumn === targetColumn) {
      return;
    }

    setSavedColumns((currentColumns) =>
      moveRawColumn(
        applyStoredRawColumnOrder(detectedColumns, currentColumns),
        sourceColumn,
        targetColumn,
      ),
    );
  }

  function handleColumnDrop(
    event: DragEvent<HTMLTableCellElement>,
    targetColumn: string,
  ) {
    event.preventDefault();

    if (draggedColumn) {
      handleMoveColumn(draggedColumn, targetColumn);
    }

    setDraggedColumn(null);
  }

  return (
    <section className="wb-table-section">
      <div className="wb-card-header">
        <div>
          <h3>{props.table.title}</h3>
          <p className="wb-card-meta">{`${ui.wbTableRows}: ${filteredRows.length}`}</p>
        </div>
      </div>

      <div className="wb-table-toolbar">
        <input
          className="wb-input wb-table-search"
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={ui.exportSearchPlaceholder}
        />
        <button
          className="wb-secondary-button wb-secondary-button--small"
          onClick={() => setSavedColumns(detectedColumns)}
          type="button"
        >
          {ui.resetColumns}
        </button>
      </div>

      {filteredRows.length > 0 && columns.length > 0 ? (
        <div
          ref={tableWrapRef}
          className="wb-table-wrap"
          onScroll={(event) => handleScroll(event.currentTarget.scrollTop)}
        >
          <table className="wb-data-table wb-data-table--compact">
            <thead>
              <tr>
                {columns.map((column, columnIndex) => (
                  <th
                    key={column}
                    className={`${getRawTableColumnClass(columnIndex, column)} ${
                      draggedColumn === column ? "wb-raw-table-column--dragging" : ""
                    }`.trim()}
                    draggable
                    title={ui.columnOrderHint}
                    onDragStart={() => setDraggedColumn(column)}
                    onDragEnd={() => setDraggedColumn(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleColumnDrop(event, column)}
                  >
                    <div className="wb-raw-table-header">
                      <span className="wb-raw-table-drag-handle" aria-hidden="true">
                        <span className="wb-raw-table-drag-line" />
                        <span className="wb-raw-table-drag-line" />
                      </span>
                      <span className="wb-raw-table-header-label">
                        {formatRawColumnLabel(column)}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topSpacerHeight > 0 ? (
                <tr className="wb-virtual-spacer-row" aria-hidden="true">
                  <td colSpan={columns.length} style={{ height: `${topSpacerHeight}px` }} />
                </tr>
              ) : null}
              {visibleRows.map((row, rowIndex) => (
                <tr key={`${props.table.id}-${startRowIndex + rowIndex}`}>
                  {columns.map((column, columnIndex) => (
                    <td
                      key={`${props.table.id}-${startRowIndex + rowIndex}-${column}`}
                      className={`${getRawTableColumnClass(columnIndex, column)} ${
                        isNumericTableValue(row[column]) ? "wb-table-cell--numeric" : ""
                      }`.trim()}
                    >
                      <span className="wb-raw-cell">{formatRawCellValue(row[column])}</span>
                    </td>
                  ))}
                </tr>
              ))}
              {bottomSpacerHeight > 0 ? (
                <tr className="wb-virtual-spacer-row" aria-hidden="true">
                  <td colSpan={columns.length} style={{ height: `${bottomSpacerHeight}px` }} />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="wb-empty-copy">{ui.archiveEmpty}</p>
      )}
    </section>
  );
}
