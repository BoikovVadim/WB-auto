import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

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

  // Виртуализация строк через @tanstack/react-virtual: окно считается от scrollTop
  // контейнера в том же кадре (без rAF-throttle, который отставал на кадр при флинге).
  const rowHeight = 24;
  const rowVirt = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => tableWrapRef.current,
    estimateSize: () => rowHeight,
    overscan: 16,
  });
  const virtualItems = rowVirt.getVirtualItems();
  const totalSize = rowVirt.getTotalSize();
  const topSpacerHeight = virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0;
  const bottomSpacerHeight =
    virtualItems.length > 0
      ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0)
      : 0;

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
    rowVirt.scrollToOffset(0);
    if (tableWrapRef.current) {
      tableWrapRef.current.scrollTop = 0;
    }
  }, [searchQuery, props.cacheKey, rowVirt]);

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
        <div ref={tableWrapRef} className="wb-table-wrap">

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
              {virtualItems.map((vi) => {
                const row = filteredRows[vi.index];
                if (!row) return null;
                return (
                  <tr key={`${props.table.id}-${vi.index}`} style={{ height: `${rowHeight}px` }}>
                    {columns.map((column, columnIndex) => (
                      <td
                        key={`${props.table.id}-${vi.index}-${column}`}
                        className={`${getRawTableColumnClass(columnIndex, column)} ${
                          isNumericTableValue(row[column]) ? "wb-table-cell--numeric" : ""
                        }`.trim()}
                      >
                        <span className="wb-raw-cell">{formatRawCellValue(row[column])}</span>
                      </td>
                    ))}
                  </tr>
                );
              })}
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
