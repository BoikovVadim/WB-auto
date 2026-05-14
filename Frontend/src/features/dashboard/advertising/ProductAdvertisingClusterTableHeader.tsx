import { forwardRef, useCallback, useRef } from "react";
import { ui } from "../copy";
import {
  isAdvertisingNumericFilterKey,
  type AdvertisingColumnRenderKey,
} from "./clusterTableView";
import {
  getAdvertisingCellClassName,
  getAdvertisingStickyStyle,
} from "./advertisingClusterTableLayout";
import { renderAdvertisingTotalsCell } from "./advertisingClusterTableCells";
import { AdvertisingClusterTableColgroup } from "./AdvertisingClusterTableColgroup";
import type { ProductAdvertisingClusterDataTableProps } from "./productAdvertisingClusterDataTableTypes";

const CLUSTER_NAME_RESIZE_MIN = 100;
const CLUSTER_NAME_RESIZE_MAX = 700;

export const ProductAdvertisingClusterTableHeader = forwardRef<
  HTMLDivElement,
  {
    stickyOffsets: Partial<Record<AdvertisingColumnRenderKey, number>>;
    tableProps: ProductAdvertisingClusterDataTableProps;
    tableWidth: number;
  }
>(function ProductAdvertisingClusterTableHeader(props, ref) {
  const { stickyOffsets, tableProps } = props;

  // Drag state ref — stores initial positions; no React state needed during drag
  // because we update the DOM directly (zero re-renders, smooth 60 fps resize).
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleResizeMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const tableWrap = (event.target as HTMLElement).closest<HTMLElement>(
        ".wb-product-workspace-table-wrap",
      );
      if (!tableWrap) return;

      const startWidth = tableProps.advertisingColumnWidths.clusterName;
      dragStateRef.current = { startX: event.clientX, startWidth };

      // Capture ALL col elements for the clusterName column across every table
      // in the wrap (header, body, sticky overlay).
      const clusterCols = Array.from(
        tableWrap.querySelectorAll<HTMLTableColElement>('col[data-col-key="clusterName"]'),
      );

      // Capture all th/td cells of the cluster column so we can set maxWidth
      // during drag — this forces overflow clipping even on position:sticky cells
      // where overflow:hidden alone does not clip reliably during DOM manipulation.
      const clusterCells = Array.from(
        tableWrap.querySelectorAll<HTMLElement>(".wb-advertising-column-cell--cluster"),
      );

      // Sticky cells to the RIGHT of the cluster column (bid + anything between them).
      // Their style.left must shift by widthDelta during drag, otherwise a white gap
      // appears between the cluster column and the bid column when narrowing.
      const clusterStickyLeft =
        clusterCells.length > 0 ? (parseFloat(clusterCells[0].style.left || "0") || 0) : 0;
      const afterClusterStickyCells = Array.from(
        tableWrap.querySelectorAll<HTMLElement>(".wb-advertising-column--sticky"),
      ).filter((el) => {
        if (el.classList.contains("wb-advertising-column-cell--cluster")) return false;
        const left = parseFloat(el.style.left || "");
        return Number.isFinite(left) && left > clusterStickyLeft;
      });
      const afterClusterInitialLefts = afterClusterStickyCells.map((el) =>
        parseFloat(el.style.left || "0"),
      );

      // Capture all table elements and their current pixel widths.
      const tables = Array.from(tableWrap.querySelectorAll<HTMLTableElement>("table"));
      const initialTableWidths = tables.map((t) => t.offsetWidth);

      const handleMouseMove = (e: MouseEvent) => {
        if (!dragStateRef.current) return;
        const delta = e.clientX - dragStateRef.current.startX;
        const newWidth = Math.min(
          CLUSTER_NAME_RESIZE_MAX,
          Math.max(CLUSTER_NAME_RESIZE_MIN, Math.round(dragStateRef.current.startWidth + delta)),
        );
        const widthPx = `${String(newWidth)}px`;
        const widthDelta = newWidth - dragStateRef.current.startWidth;

        for (const col of clusterCols) {
          col.style.width = widthPx;
          col.style.minWidth = widthPx;
        }
        // Force content clipping: maxWidth on the actual cells ensures text
        // never bleeds into the adjacent "Ставка" column during drag.
        for (const cell of clusterCells) {
          cell.style.maxWidth = widthPx;
        }
        // Shift sticky columns to the right of the cluster (bid, etc.) so they
        // stay flush with the cluster right edge and no white gap appears.
        afterClusterStickyCells.forEach((cell, i) => {
          cell.style.left = `${String(afterClusterInitialLefts[i] + widthDelta)}px`;
        });
        tables.forEach((table, i) => {
          table.style.width = `${String(initialTableWidths[i] + widthDelta)}px`;
        });
      };

      const handleMouseUp = (e: MouseEvent) => {
        if (!dragStateRef.current) return;
        const delta = e.clientX - dragStateRef.current.startX;
        const finalWidth = Math.min(
          CLUSTER_NAME_RESIZE_MAX,
          Math.max(CLUSTER_NAME_RESIZE_MIN, Math.round(dragStateRef.current.startWidth + delta)),
        );
        dragStateRef.current = null;
        // Clear inline maxWidth before React re-renders (avoids stale inline styles).
        // React will restore correct style.left for sticky cells via stickyOffsets.
        for (const cell of clusterCells) {
          cell.style.maxWidth = "";
        }
        // Commit to React state + localStorage; React re-renders with the same
        // finalWidth so the DOM settles without any visual jump.
        tableProps.onClusterNameWidthChange(finalWidth);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [tableProps],
  );

  return (
    <div ref={ref} className="wb-advertising-sticky-header-block">
      <table
        className="wb-data-table wb-data-table--product-sheet wb-data-table--advertising wb-advertising-sticky-header-table"
        style={{ tableLayout: "fixed", width: `${String(props.tableWidth)}px` }}
      >
        <AdvertisingClusterTableColgroup
          advertisingColumnWidths={tableProps.advertisingColumnWidths}
          orderedAdvertisingColumns={tableProps.orderedAdvertisingColumns}
          prefix="sticky-header-col"
        />
        <thead>
          <tr>
            <th
              className={getAdvertisingCellClassName(stickyOffsets, "select", {
                header: true,
              })}
              style={getAdvertisingStickyStyle(stickyOffsets, "select")}
            >
              <input
                type="checkbox"
                className="wb-advertising-checkbox"
                checked={tableProps.allVisibleClustersSelected}
                onChange={tableProps.onToggleSelectAllClusterGroups}
                aria-label="Выбрать все кластеры"
              />
            </th>
            {tableProps.orderedAdvertisingColumns.map(({ key: value, label }) => {
              const isActive = tableProps.sortState.key === value;
              const isClusterName = value === "clusterName";
              const ariaSort = !isActive
                ? "none"
                : tableProps.sortState.direction === "asc"
                  ? "ascending"
                  : "descending";

              return (
                <th
                  key={`sticky-header-${value}`}
                  aria-sort={ariaSort}
                  className={`${getAdvertisingCellClassName(stickyOffsets, value, {
                    header: true,
                    dragging: tableProps.draggedAdvertisingColumn === value,
                  })}${isActive ? " is-sorted" : ""}${isClusterName ? " wb-advertising-th--resizable" : ""}`}
                  style={getAdvertisingStickyStyle(stickyOffsets, value)}
                  draggable
                  title={ui.columnOrderHint}
                  onDragStart={() => tableProps.onSetDraggedAdvertisingColumn(value)}
                  onDragEnd={() => tableProps.onSetDraggedAdvertisingColumn(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => tableProps.onAdvertisingColumnDrop(event, value)}
                >
                  <div className="wb-raw-table-header">
                    <span className="wb-raw-table-drag-handle" aria-hidden="true">
                      <span className="wb-raw-table-drag-line" />
                      <span className="wb-raw-table-drag-line" />
                    </span>
                    <button
                      type="button"
                      className="wb-data-table__sort-button"
                      onClick={() => tableProps.onSortChange(value)}
                      aria-label={`${label}: ${
                        isActive && tableProps.sortState.direction === "asc"
                          ? "По убыванию"
                          : "По возрастанию"
                      }`}
                    >
                      <span>{label}</span>
                      <span
                        className={`wb-data-table__sort-arrow${isActive ? " is-active" : ""}`}
                        aria-hidden="true"
                      >
                        {isActive
                          ? tableProps.sortState.direction === "asc"
                            ? "↑"
                            : "↓"
                          : "↕"}
                      </span>
                    </button>
                  </div>
                  {isClusterName ? (
                    <span
                      className="wb-advertising-resize-handle"
                      title="Потяните, чтобы изменить ширину столбца"
                      aria-hidden="true"
                      onMouseDown={handleResizeMouseDown}
                    />
                  ) : null}
                </th>
              );
            })}
          </tr>
          <tr className="wb-data-table__header-filter-row">
            <th
              className={getAdvertisingCellClassName(stickyOffsets, "select", {
                header: true,
              })}
              style={getAdvertisingStickyStyle(stickyOffsets, "select")}
            />
            {tableProps.orderedAdvertisingColumns.map(({ key, filterKind, label }) => (
              <th
                key={`sticky-filter-${key}`}
                className={getAdvertisingCellClassName(stickyOffsets, key, {
                  header: true,
                })}
                style={getAdvertisingStickyStyle(stickyOffsets, key)}
              >
                {filterKind === "search" ? (
                  <div className="wb-data-table__column-filter-dual-search">
                    <input
                      className="wb-data-table__column-filter"
                      type="search"
                      value={tableProps.clusterNameSearch}
                      onChange={(event) => tableProps.onClusterNameSearchChange(event.target.value)}
                      placeholder="Кластер"
                      aria-label="Поиск по названию кластера"
                    />
                    <input
                      className="wb-data-table__column-filter"
                      type="search"
                      value={tableProps.clusterSearch}
                      onChange={(event) => tableProps.onClusterSearchChange(event.target.value)}
                      placeholder="Запрос"
                      aria-label="Поиск по запросам"
                    />
                  </div>
                ) : filterKind === "number" && isAdvertisingNumericFilterKey(key) ? (
                  <div className="wb-data-table__column-filter-range">
                    <input
                      className="wb-data-table__column-filter"
                      type="text"
                      inputMode="decimal"
                      value={tableProps.numericFilters[key].min}
                      onChange={(event) =>
                        tableProps.onNumericFilterChange(key, "min", event.target.value)
                      }
                      onBlur={() => tableProps.onApplyNumericFilter(key)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          tableProps.onApplyNumericFilter(key);
                        }
                      }}
                      placeholder="От"
                      aria-label={`${label} от`}
                    />
                    <input
                      className="wb-data-table__column-filter"
                      type="text"
                      inputMode="decimal"
                      value={tableProps.numericFilters[key].max}
                      onChange={(event) =>
                        tableProps.onNumericFilterChange(key, "max", event.target.value)
                      }
                      onBlur={() => tableProps.onApplyNumericFilter(key)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          tableProps.onApplyNumericFilter(key);
                        }
                      }}
                      placeholder="До"
                      aria-label={`${label} до`}
                    />
                  </div>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="wb-advertising-totals-row wb-advertising-totals-row--sticky">
            <td
              className={getAdvertisingCellClassName(stickyOffsets, "select")}
              style={getAdvertisingStickyStyle(stickyOffsets, "select")}
            />
            {tableProps.orderedAdvertisingColumns.map(({ key }) => (
              <td
                key={`sticky-totals-${key}`}
                className={getAdvertisingCellClassName(stickyOffsets, key)}
                style={getAdvertisingStickyStyle(stickyOffsets, key)}
              >
                {renderAdvertisingTotalsCell(key, tableProps.visibleClusterTotals)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
});
