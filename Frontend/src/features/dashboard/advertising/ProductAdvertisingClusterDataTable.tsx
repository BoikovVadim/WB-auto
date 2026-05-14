import { useRef, useMemo, useState, useEffect, useCallback, useLayoutEffect } from "react";

import {
  loadScrollPosition,
  saveScrollPosition,
} from "../persistence/scrollPositionPersistence";

import { ProductAdvertisingClusterTableBody } from "./ProductAdvertisingClusterTableBody";
import { ProductAdvertisingClusterTableHeader } from "./ProductAdvertisingClusterTableHeader";
import { getStickyOffsets, getAdvertisingCellClassName, getAdvertisingStickyStyle } from "./advertisingClusterTableLayout";
import { buildAdvertisingClusterGroupKey, getAdvertisingClusterRowClass } from "./clusterTableView";
import { buildWorkspaceClusterQueriesView } from "./productWorkspaceLocalView";
import { renderAdvertisingGroupCell } from "./advertisingClusterTableCells";
import { AdvertisingClusterTableColgroup } from "./AdvertisingClusterTableColgroup";
import type { ProductAdvertisingClusterDataTableProps } from "./productAdvertisingClusterDataTableTypes";
import type { ProductAdvertisingWorkspaceClusterSortKey, ProductAdvertisingWorkspaceClusterSortDirection } from "../../../api/syncClientAdvertisingWorkspaceTypes";

// Must match --wb-advertising-sticky-header-total (30 + 40 + 20 px).
const STICKY_HEADER_PX = 90;

export type ProductAdvertisingClusterBodyEntry =
  | {
      kind: "cluster";
      key: string;
      clusterKey: string;
      row: ProductAdvertisingClusterDataTableProps["visibleClusterRows"][number];
    }
  | {
      kind: "query";
      key: string;
      clusterKey: string;
      row: ProductAdvertisingClusterDataTableProps["visibleClusterRows"][number];
      query: NonNullable<
        ProductAdvertisingClusterDataTableProps["productAdvertisingClusterQueriesByKey"][string]["data"]
      >["queries"][number];
    }
  | {
      kind: "placeholder";
      key: string;
      clusterKey: string;
      row: ProductAdvertisingClusterDataTableProps["visibleClusterRows"][number];
      message: string;
      tone: "muted" | "error";
    };

export function ProductAdvertisingClusterDataTable(
  props: ProductAdvertisingClusterDataTableProps,
) {
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const stickyHeaderRef = useRef<HTMLDivElement | null>(null);

  // Measure the exact available height for the table-wrap so that the section
  // scroll range equals precisely the campaigns area — the table-wrap never
  // over-scrolls under the toolbar.
  useLayoutEffect(() => {
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) return;
    const section = tableWrap.closest<HTMLElement>(".wb-product-workspace");
    if (!section) return;
    const toolbar = section.querySelector<HTMLElement>(".wb-advertising-toolbar");
    if (!toolbar) return;

    const update = () => {
      const sectionH = section.clientHeight;
      const cs = getComputedStyle(section);
      const sectionPaddingTop = parseFloat(cs.paddingTop) || 0;
      const sectionPaddingBottom = parseFloat(cs.paddingBottom) || 0;
      const toolbarH = toolbar.offsetHeight;
      const h = sectionH - sectionPaddingTop - sectionPaddingBottom - toolbarH;
      if (h > 0) {
        tableWrap.style.height = `${String(h)}px`;
        tableWrap.style.maxHeight = `${String(h)}px`;
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(section);
    ro.observe(toolbar);
    return () => ro.disconnect();
  }, []); // empty — ResizeObserver handles all subsequent size changes

  // Scroll persistence: key is specific to the current product + campaign so
  // each combination gets its own saved position.
  const scrollKey = props.nmId !== null && props.selectedCampaignAdvertId !== null
    ? `cluster-table:${String(props.nmId)}:${String(props.selectedCampaignAdvertId)}`
    : null;
  const scrollKeyRef = useRef(scrollKey);

  // Restore scroll position when the table mounts or the campaign changes.
  useLayoutEffect(() => {
    const el = tableWrapRef.current;
    if (!el || !scrollKey) return;
    const saved = loadScrollPosition(scrollKey);
    if (saved > 0) {
      el.scrollTop = saved;
    }
  }, [scrollKey]); // intentionally keyed on scrollKey — restores when campaign switches

  // Keep the ref fresh so the scroll handler always uses the latest key.
  useEffect(() => {
    scrollKeyRef.current = scrollKey;
  });

  // Which expanded cluster key is currently "stuck" (scrolled above the sticky header).
  const [stuckClusterKey, setStuckClusterKey] = useState<string | null>(null);
  const stuckClusterKeyRef = useRef<string | null>(null);

  const stickyOffsets = useMemo(
    () =>
      getStickyOffsets(
        props.advertisingColumnWidths,
        props.orderedAdvertisingColumns,
      ),
    [props.advertisingColumnWidths, props.orderedAdvertisingColumns],
  );

  const totalWidth = useMemo(
    () =>
      props.advertisingColumnWidths.select +
      props.orderedAdvertisingColumns.reduce(
        (sum, col) => sum + props.advertisingColumnWidths[col.key],
        0,
      ),
    [props.advertisingColumnWidths, props.orderedAdvertisingColumns],
  );

  // Scroll-based detection: find which expanded cluster row has scrolled above the header.
  // Only fires a React state update when the stuck key actually CHANGES (entering/leaving
  // the sticky zone), so scroll events never trigger unnecessary re-renders.
  const checkStuck = useCallback(() => {
    const container = tableWrapRef.current;
    if (!container || props.expandedClusterKeys.length === 0) {
      if (stuckClusterKeyRef.current !== null) {
        stuckClusterKeyRef.current = null;
        setStuckClusterKey(null);
      }
      return;
    }

    let newStuck: string | null = null;
    const containerTop = container.getBoundingClientRect().top;
    for (const key of props.expandedClusterKeys) {
      const row = container.querySelector<HTMLElement>(`[data-cluster-key="${CSS.escape(key)}"]`);
      if (row) {
        const rowTop = row.getBoundingClientRect().top;
        if (rowTop - containerTop < STICKY_HEADER_PX) {
          newStuck = key;
          break;
        }
      }
    }

    if (newStuck !== stuckClusterKeyRef.current) {
      stuckClusterKeyRef.current = newStuck;
      setStuckClusterKey(newStuck);
    }
  }, [props.expandedClusterKeys]);

  useEffect(() => {
    const container = tableWrapRef.current;
    if (!container) return;

    // Re-check immediately whenever expanded clusters change.
    checkStuck();

    const handleScroll = () => {
      checkStuck();
      if (scrollKeyRef.current) {
        saveScrollPosition(scrollKeyRef.current, container.scrollTop);
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [checkStuck]);

  const bodyEntries = useMemo(() => {
    const entries: ProductAdvertisingClusterBodyEntry[] = [];

    for (const row of props.visibleClusterRows) {
      const clusterKey = buildAdvertisingClusterGroupKey(row);
      const clusterQueriesState = props.productAdvertisingClusterQueriesByKey[clusterKey] ?? null;
      const clusterQueries = clusterQueriesState?.data?.queries ?? [];
      const isExpanded = props.expandedClusterKeys.includes(clusterKey);

      entries.push({
        kind: "cluster",
        key: clusterKey,
        clusterKey,
        row,
      });

      if (!isExpanded) {
        continue;
      }

      if (!clusterQueriesState || clusterQueriesState.loading) {
        entries.push({
          kind: "placeholder",
          key: `${clusterKey}:loading`,
          clusterKey,
          row,
          message: "...",
          tone: "muted",
        });
        continue;
      }

      if (clusterQueriesState?.error) {
        entries.push({
          kind: "placeholder",
          key: `${clusterKey}:error`,
          clusterKey,
          row,
          message: clusterQueriesState.error,
          tone: "error",
        });
        continue;
      }

      if (clusterQueriesState.data && clusterQueries.length === 0) {
        entries.push({
          kind: "placeholder",
          key: `${clusterKey}:empty`,
          clusterKey,
          row,
          message: "Нет запросов",
          tone: "muted",
        });
        continue;
      }

      // Re-sort queries client-side so that sort-direction changes apply
      // immediately without waiting for a server round-trip.
      const sortedQueries = clusterQueriesState.data
        ? buildWorkspaceClusterQueriesView({
            snapshot: clusterQueriesState.data,
            sortKey: props.sortState.key as ProductAdvertisingWorkspaceClusterSortKey,
            sortDirection: props.sortState.direction as ProductAdvertisingWorkspaceClusterSortDirection,
          }).queries
        : clusterQueries;

      if (sortedQueries.length === 0) {
        entries.push({
          kind: "placeholder",
          key: `${clusterKey}:empty`,
          clusterKey,
          row,
          message: "Нет запросов",
          tone: "muted",
        });
        continue;
      }

      for (const query of sortedQueries) {
        entries.push({
          kind: "query",
          key: `${clusterKey}:${query.queryText}`,
          clusterKey,
          row,
          query,
        });
      }
    }

    return entries;
  }, [
    props.expandedClusterKeys,
    props.productAdvertisingClusterQueriesByKey,
    props.sortState,
    props.visibleClusterRows,
  ]);

  // Find the stuck cluster's row data for the overlay rendering.
  const stuckBodyEntry = useMemo(() => {
    if (!stuckClusterKey) return null;
    for (const entry of bodyEntries) {
      if (entry.kind === "cluster" && entry.clusterKey === stuckClusterKey) {
        return entry;
      }
    }
    return null;
  }, [bodyEntries, stuckClusterKey]);

  return (
    <div
      ref={tableWrapRef}
      className="wb-table-wrap wb-product-workspace-table-wrap"
    >
      <ProductAdvertisingClusterTableHeader
        ref={stickyHeaderRef}
        stickyOffsets={stickyOffsets}
        tableProps={props}
        tableWidth={totalWidth}
      />

      {/* Sticky cluster row overlay — a <div> with position:sticky (not <tr>, which
          is unreliable). Zero height so it never pushes the body table down. Rendered
          only when the expanded cluster has scrolled above the sticky header. */}
      {stuckClusterKey !== null && stuckBodyEntry !== null ? (
        <div
          className="wb-advertising-sticky-cluster-overlay"
          style={{ top: `${String(STICKY_HEADER_PX)}px` }}
        >
          <table
            className="wb-data-table wb-data-table--product-sheet wb-data-table--advertising"
            style={{ tableLayout: "fixed", width: `${String(totalWidth)}px` }}
          >
            <AdvertisingClusterTableColgroup
              advertisingColumnWidths={props.advertisingColumnWidths}
              orderedAdvertisingColumns={props.orderedAdvertisingColumns}
              prefix="sticky-cluster-col"
            />
            <tbody>
              <tr className={`${getAdvertisingClusterRowClass(stuckBodyEntry.row)} wb-advertising-group-row is-expanded${props.selectedClusterKeys.includes(stuckClusterKey) ? " is-selected" : ""}`}>
                <td
                  className={getAdvertisingCellClassName(stickyOffsets, "select")}
                  style={getAdvertisingStickyStyle(stickyOffsets, "select")}
                >
                  <input
                    type="checkbox"
                    className="wb-advertising-checkbox"
                    checked={props.selectedClusterKeys.includes(stuckClusterKey)}
                    onChange={() => props.onToggleSelectedClusterGroup(stuckClusterKey)}
                    aria-label={`Выбрать кластер ${stuckBodyEntry.row.clusterName}`}
                  />
                </td>
                {props.orderedAdvertisingColumns.map(({ key }) => (
                  <td
                    key={`sticky-cluster:${key}`}
                    className={getAdvertisingCellClassName(stickyOffsets, key)}
                    style={getAdvertisingStickyStyle(stickyOffsets, key)}
                  >
                    {renderAdvertisingGroupCell({
                      columnKey: key,
                      row: stuckBodyEntry.row,
                      queries:
                        props.productAdvertisingClusterQueriesByKey[stuckClusterKey]?.data
                          ?.queries ?? [],
                      isExpanded: true,
                      copiedClusterKey: props.copiedClusterKey,
                      onToggleClusterGroup: props.onToggleClusterGroup,
                      onCopyClusterName: props.onCopyClusterName,
                      renderClusterBidCell: props.renderClusterBidCell,
                    })}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      <ProductAdvertisingClusterTableBody
        stickyOffsets={stickyOffsets}
        tableProps={props}
        bodyEntries={bodyEntries}
        topSpacerHeight={0}
        bottomSpacerHeight={0}
        tableWidth={totalWidth}
        hiddenClusterKey={stuckClusterKey}
      />
    </div>
  );
}
