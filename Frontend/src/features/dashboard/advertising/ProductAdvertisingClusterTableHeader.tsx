import { forwardRef } from "react";
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

export const ProductAdvertisingClusterTableHeader = forwardRef<
  HTMLDivElement,
  {
    stickyOffsets: Partial<Record<AdvertisingColumnRenderKey, number>>;
    tableProps: ProductAdvertisingClusterDataTableProps;
    tableWidth: number;
  }
>(function ProductAdvertisingClusterTableHeader(props, ref) {
  const { stickyOffsets, tableProps } = props;

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
                  })}${isActive ? " is-sorted" : ""}`}
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
                  <input
                    className="wb-data-table__column-filter"
                    type="search"
                    value={tableProps.clusterSearch}
                    onChange={(event) => tableProps.onClusterSearchChange(event.target.value)}
                    placeholder={label}
                    aria-label={`Поиск по столбцу ${label}`}
                  />
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
