import { Fragment, memo, useMemo } from "react";

import {
  getAdvertisingClusterRowClass,
  getAdvertisingQueryRowClass,
  type AdvertisingColumnRenderKey,
} from "./clusterTableView";
import {
  getAdvertisingCellClassName,
  getAdvertisingStickyStyle,
} from "./advertisingClusterTableLayout";
import {
  renderEmptyAdvertisingQueryCell,
  renderAdvertisingGroupCell,
  renderAdvertisingQueryCell,
} from "./advertisingClusterTableCells";
import { AdvertisingClusterTableColgroup } from "./AdvertisingClusterTableColgroup";
import type { ProductAdvertisingClusterDataTableProps } from "./productAdvertisingClusterDataTableTypes";
import type { ProductAdvertisingClusterBodyEntry } from "./ProductAdvertisingClusterDataTable";

export const ProductAdvertisingClusterTableBody = memo(function ProductAdvertisingClusterTableBody(props: {
  stickyOffsets: Partial<Record<AdvertisingColumnRenderKey, number>>;
  tableProps: ProductAdvertisingClusterDataTableProps;
  bodyEntries: ProductAdvertisingClusterBodyEntry[];
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  tableWidth: number;
  /** Key of the expanded cluster that is currently shown by the sticky overlay.
   *  The matching <tr> is hidden (visibility:hidden) to avoid visual duplication. */
  hiddenClusterKey: string | null;
}) {
  const { stickyOffsets, tableProps, hiddenClusterKey } = props;
  const selectedClusterKeySet = useMemo(
    () => new Set(tableProps.selectedClusterKeys),
    [tableProps.selectedClusterKeys],
  );
  const columnCount = tableProps.orderedAdvertisingColumns.length + 1;

  return (
      <table
        className="wb-data-table wb-data-table--product-sheet wb-data-table--advertising"
        style={{ tableLayout: "fixed", width: `${String(props.tableWidth)}px` }}
      >
      <AdvertisingClusterTableColgroup
        advertisingColumnWidths={tableProps.advertisingColumnWidths}
        orderedAdvertisingColumns={tableProps.orderedAdvertisingColumns}
        prefix="col"
      />
      <tbody>
        {props.topSpacerHeight > 0 ? (
          <tr aria-hidden="true" className="wb-windowing-spacer-row">
            <td colSpan={columnCount} style={{ height: `${String(props.topSpacerHeight)}px` }} />
          </tr>
        ) : null}
        {props.bodyEntries.map((entry) => {
          if (entry.kind === "cluster") {
            const clusterQueries =
              tableProps.productAdvertisingClusterQueriesByKey[entry.clusterKey]?.data?.queries ?? [];
            const isExpanded = tableProps.expandedClusterKeys.includes(entry.clusterKey);

            return (
              <tr
                key={entry.key}
                data-cluster-key={entry.clusterKey}
                className={`${getAdvertisingClusterRowClass(entry.row)} wb-advertising-group-row${isExpanded ? " is-expanded" : ""}${hiddenClusterKey === entry.clusterKey ? " is-stuck-hidden" : ""}`}
              >
                <td
                  className={getAdvertisingCellClassName(stickyOffsets, "select")}
                  style={getAdvertisingStickyStyle(stickyOffsets, "select")}
                >
                  <input
                    type="checkbox"
                    className="wb-advertising-checkbox"
                    checked={selectedClusterKeySet.has(entry.clusterKey)}
                    onChange={() => tableProps.onToggleSelectedClusterGroup(entry.clusterKey)}
                    aria-label={`Выбрать кластер ${entry.row.clusterName}`}
                  />
                </td>
                {tableProps.orderedAdvertisingColumns.map(({ key }) => (
                  <td
                    key={`${entry.clusterKey}:${key}`}
                    className={getAdvertisingCellClassName(stickyOffsets, key)}
                    style={getAdvertisingStickyStyle(stickyOffsets, key)}
                  >
                    {renderAdvertisingGroupCell({
                      columnKey: key,
                      row: entry.row,
                      queries: clusterQueries,
                      isExpanded,
                      copiedClusterKey: tableProps.copiedClusterKey,
                      onToggleClusterGroup: tableProps.onToggleClusterGroup,
                      onCopyClusterName: tableProps.onCopyClusterName,
                      renderClusterBidCell: tableProps.renderClusterBidCell,
                    })}
                  </td>
                ))}
              </tr>
            );
          }

          if (entry.kind === "query") {
            return (
              <tr key={entry.key} className={getAdvertisingQueryRowClass(entry.query)}>
                <td
                  className={getAdvertisingCellClassName(stickyOffsets, "select")}
                  style={getAdvertisingStickyStyle(stickyOffsets, "select")}
                />
                {tableProps.orderedAdvertisingColumns.map(({ key }) => (
                  <td
                    key={`${entry.key}:${key}`}
                    className={getAdvertisingCellClassName(stickyOffsets, key)}
                    style={getAdvertisingStickyStyle(stickyOffsets, key)}
                  >
                    {renderAdvertisingQueryCell(
                      key,
                      entry.row,
                      entry.query,
                      tableProps.renderClusterBidCell,
                      {
                        queryKey: entry.key,
                        copiedQueryKey: tableProps.copiedQueryKey,
                        onCopyQueryText: tableProps.onCopyQueryText,
                      },
                    )}
                  </td>
                ))}
              </tr>
            );
          }

          const isLoading = entry.key.endsWith(":loading");
          return (
            <Fragment key={entry.key}>
              <tr
                className={
                  entry.tone === "error"
                    ? "wb-advertising-query wb-advertising-query--placeholder is-error"
                    : isLoading
                      ? "wb-advertising-query wb-advertising-query--placeholder is-loading"
                      : "wb-advertising-query wb-advertising-query--placeholder"
                }
              >
                <td
                  className={getAdvertisingCellClassName(stickyOffsets, "select")}
                  style={getAdvertisingStickyStyle(stickyOffsets, "select")}
                />
                {tableProps.orderedAdvertisingColumns.map(({ key }) => (
                  <td
                    key={`${entry.key}:${key}`}
                    className={getAdvertisingCellClassName(stickyOffsets, key)}
                    style={getAdvertisingStickyStyle(stickyOffsets, key)}
                  >
                    {!isLoading && key === "clusterName"
                      ? renderEmptyAdvertisingQueryCell(key, entry.message)
                      : null}
                  </td>
                ))}
              </tr>
            </Fragment>
          );
        })}
        {props.bottomSpacerHeight > 0 ? (
          <tr aria-hidden="true" className="wb-windowing-spacer-row">
            <td colSpan={columnCount} style={{ height: `${String(props.bottomSpacerHeight)}px` }} />
          </tr>
        ) : null}
      </tbody>
    </table>
  );
});
