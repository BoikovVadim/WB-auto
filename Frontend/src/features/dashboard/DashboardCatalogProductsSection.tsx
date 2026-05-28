import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { CostPriceCurrent } from "../../api/syncClientCostPrice";
import type { TodayOrderCount } from "../../api/syncClientOrders";
import { ui } from "./copy";
import {
  loadScrollPosition,
  saveScrollPosition,
} from "./persistence/scrollPositionPersistence";
import type { ProductListItem, ProductListSortKey } from "./useDashboardProductsWorkspace";

export type { CostPriceCurrent };

const CATALOG_PRODUCTS_SCROLL_KEY = "catalog-products-list";

type DashboardCatalogProductsSectionProps = {
  productCatalogCount: number;
  productsSearch: string;
  hasCatalogItems: boolean;
  isCatalogLoading: boolean;
  filteredProducts: ProductListItem[];
  productsSortKey: ProductListSortKey;
  productsSortDirection: "asc" | "desc";
  costPrices: Map<number, CostPriceCurrent>;
  orderCounts: Map<number, TodayOrderCount>;
  onProductsSearchChange: (value: string) => void;
  onProductsSortToggle: (key: ProductListSortKey) => void;
  onOpenCostPriceSheet: () => void;
  onOpenOrdersSheet: () => void;
  onOpenJamSheet: () => void;
  onOpenStocksSheet: () => void;
  onCostSaved: (nmId: number, value: number) => Promise<void>;
  onCostCleared: (nmIds: number[]) => Promise<void>;
};

function SortArrow({
  active,
  direction,
}: {
  active: boolean;
  direction: "asc" | "desc";
}) {
  return (
    <span className={active ? "wb-sort-arrow--active" : "wb-sort-arrow--inactive"}>
      {active ? (direction === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );
}

type CostInputCellProps = {
  nmId: number;
  savedValue: number | null;
  isSelected: boolean;
  isEditing: boolean;
  onSaved: (nmId: number, value: number) => Promise<void>;
  onCommitEdit: () => void;
};

const CostInputCell = memo(function CostInputCell({
  nmId,
  savedValue,
  isSelected,
  isEditing,
  onSaved,
  onCommitEdit,
}: CostInputCellProps) {
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const savedValueRef = useRef(savedValue);
  useEffect(() => {
    savedValueRef.current = savedValue;
  }, [savedValue]);

  const startDraft = useCallback(() => {
    setDraft(savedValueRef.current !== null ? String(savedValueRef.current) : "");
  }, []);

  useEffect(() => {
    if (isEditing) {
      startDraft();
    }
  }, [isEditing, startDraft]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const commit = useCallback(async () => {
    const trimmed = draft.trim().replace(",", ".");
    const currentSaved = savedValueRef.current;
    if (trimmed === "") {
      onCommitEdit();
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      onCommitEdit();
      return;
    }
    if (parsed === currentSaved) {
      onCommitEdit();
      return;
    }
    setSaving(true);
    try {
      await onSaved(nmId, parsed);
      onCommitEdit();
    } catch {
      // keep editing so user can retry
    } finally {
      setSaving(false);
    }
  }, [draft, nmId, onSaved, onCommitEdit]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className={`wb-cost-price-input${saving ? " wb-cost-price-input--saving" : ""}`}
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder="0"
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { void commit(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            onCommitEdit();
          }
          e.stopPropagation();
        }}
        // Prevent click inside input from bubbling up to cell selection logic
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Себестоимость"
      />
    );
  }

  return (
    <span
      className={`wb-cost-price-display${isSelected ? " wb-cost-price-display--selected" : ""}`}
    >
      {savedValue !== null
        ? `${savedValue.toLocaleString("ru-RU")} ₽`
        : <span className="wb-cost-price-empty">—</span>}
    </span>
  );
});

export const DashboardCatalogProductsSection = memo(
  function DashboardCatalogProductsSection(props: DashboardCatalogProductsSectionProps) {
    const tableWrapRef = useRef<HTMLDivElement | null>(null);
    const tableRef = useRef<HTMLTableElement | null>(null);
    const resizingColRef = useRef<number | null>(null);

    // ── Multi-select state ──────────────────────────────────────────────────
    const [selectedNmIds, setSelectedNmIds] = useState<Set<number>>(new Set());
    const [editingNmId, setEditingNmId] = useState<number | null>(null);
    const lastClickedIndexRef = useRef<number>(-1);

    const handleCommitEdit = useCallback(() => {
      setEditingNmId(null);
    }, []);

    const handleCellClick = useCallback(
      (nmId: number, index: number, event: React.MouseEvent) => {
        // Don't interfere if we're in the input
        if ((event.target as HTMLElement).tagName === "INPUT") return;

        if (event.ctrlKey || event.metaKey) {
          // Toggle selection, no edit
          setSelectedNmIds((prev) => {
            const next = new Set(prev);
            if (next.has(nmId)) next.delete(nmId);
            else next.add(nmId);
            return next;
          });
          lastClickedIndexRef.current = index;
          setEditingNmId(null);
        } else if (event.shiftKey && lastClickedIndexRef.current >= 0) {
          // Range select
          const from = Math.min(lastClickedIndexRef.current, index);
          const to = Math.max(lastClickedIndexRef.current, index);
          setSelectedNmIds(() => {
            const next = new Set<number>();
            for (let i = from; i <= to; i++) {
              const p = props.filteredProducts[i];
              if (p?.nmId !== null && p?.nmId !== undefined) next.add(p.nmId);
            }
            return next;
          });
          setEditingNmId(null);
        } else if (selectedNmIds.size > 0) {
          // Had selection — single-click clears selection, selects this cell only
          setSelectedNmIds(new Set([nmId]));
          lastClickedIndexRef.current = index;
          setEditingNmId(null);
        } else {
          // No prior selection — single click enters edit mode
          setSelectedNmIds(new Set());
          lastClickedIndexRef.current = index;
          setEditingNmId(nmId);
        }
      },
      [selectedNmIds, props.filteredProducts],
    );

    const handleCellDoubleClick = useCallback((nmId: number, index: number) => {
      setSelectedNmIds(new Set());
      lastClickedIndexRef.current = index;
      setEditingNmId(nmId);
    }, []);

    // ── Keyboard handler for Delete/Backspace/Enter/Escape ─────────────────
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        // Skip if an input is focused (we don't want to intercept while editing)
        if (
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement
        ) return;

        if ((e.key === "Delete" || e.key === "Backspace") && selectedNmIds.size > 0) {
          e.preventDefault();
          const ids = Array.from(selectedNmIds);
          void props.onCostCleared(ids).then(() => {
            setSelectedNmIds(new Set());
          });
        } else if (e.key === "Escape") {
          setSelectedNmIds(new Set());
          setEditingNmId(null);
        } else if (e.key === "Enter" && selectedNmIds.size === 1) {
          const [id] = selectedNmIds;
          if (id !== undefined) {
            setSelectedNmIds(new Set());
            setEditingNmId(id);
          }
        }
      };
      document.addEventListener("keydown", handler);
      return () => document.removeEventListener("keydown", handler);
    }, [selectedNmIds, props.onCostCleared]);

    // Click outside the table clears selection
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (tableRef.current && !tableRef.current.contains(e.target as Node)) {
          setSelectedNmIds(new Set());
          setEditingNmId(null);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, []);

    const getDisplayVendorCode = (p: { vendorCode: string; nmId: number | null }) =>
      p.vendorCode !== "" ? p.vendorCode : p.nmId !== null ? `#${String(p.nmId)}` : "—";

    const widestVendorCode = useMemo(
      () =>
        props.filteredProducts.reduce((max, p) => {
          const display = getDisplayVendorCode(p);
          return display.length > max.length ? display : max;
        }, ""),
      [props.filteredProducts],
    );

    const nameColWidth = useMemo(() => {
      const MIN_WIDTH = 130;
      if (!widestVendorCode) return MIN_WIDTH;
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return Math.max(widestVendorCode.length * 9 + 22, MIN_WIDTH);
        ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
        return Math.max(Math.ceil(ctx.measureText(widestVendorCode).width) + 22, MIN_WIDTH);
      } catch {
        return Math.max(widestVendorCode.length * 9 + 22, MIN_WIDTH);
      }
    }, [widestVendorCode]);

    const CATEGORY_COL_WIDTH = 160;
    const SUBJECT_COL_WIDTH = 120;
    const COST_COL_WIDTH = 140;
    const ORDERS_COL_WIDTH = 110;
    const totalW = 48 + 110 + nameColWidth + CATEGORY_COL_WIDTH + SUBJECT_COL_WIDTH + COST_COL_WIDTH + ORDERS_COL_WIDTH;

    const minResizableWidthByColumn = useMemo(
      () =>
        new Map<number, number>([
          [2, 90],
          [3, 90],
          [4, 80],
        ]),
      [],
    );

    const handleResizeMouseDown = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!tableRef.current) return;
        const colIndex = Number((event.currentTarget as HTMLElement).dataset.colIdx ?? "-1");
        if (!Number.isFinite(colIndex) || colIndex < 0) return;
        const tableEl = tableRef.current;
        const cols = tableEl.querySelectorAll<HTMLTableColElement>("colgroup col");
        if (!cols[colIndex]) return;

        const measuredColWidths = Array.from(cols).map((col) => {
          const measured = col.getBoundingClientRect().width;
          if (measured > 0) return measured;
          const parsed = Number.parseFloat(col.style.width);
          return Number.isFinite(parsed) ? parsed : 0;
        });
        const initialSelectedWidth = measuredColWidths[colIndex] ?? 0;
        const startX = event.clientX;
        resizingColRef.current = colIndex;
        document.body.style.cursor = "col-resize";

        const onMouseMove = (moveEvent: MouseEvent) => {
          if (resizingColRef.current === null || !tableRef.current) return;
          const ths = tableEl.querySelectorAll<HTMLTableCellElement>("thead th");
          const th = ths[resizingColRef.current];
          if (!th) return;
          const minWidth = minResizableWidthByColumn.get(resizingColRef.current) ?? 48;
          const delta = moveEvent.clientX - startX;
          const newWidth = Math.max(minWidth, initialSelectedWidth + delta);
          th.style.width = `${newWidth}px`;
          const col = tableEl.querySelector<HTMLTableColElement>(
            `colgroup col:nth-child(${String(resizingColRef.current + 1)})`,
          );
          if (col) col.style.width = `${newWidth}px`;
          const totalTableWidth = measuredColWidths.reduce(
            (sum, w, i) => sum + (i === resizingColRef.current ? newWidth : w),
            0,
          );
          tableEl.style.width = `${Math.ceil(totalTableWidth)}px`;
        };

        const onMouseUp = () => {
          resizingColRef.current = null;
          document.body.style.cursor = "";
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp, { once: true });
      },
      [minResizableWidthByColumn],
    );

    useLayoutEffect(() => {
      const el = tableWrapRef.current;
      if (!el) return;
      const target = loadScrollPosition(CATALOG_PRODUCTS_SCROLL_KEY);
      if (target > 0) el.scrollTop = target;
    }, [props.hasCatalogItems]);

    const { productsSortKey: sortKey, productsSortDirection: sortDir } = props;

    const totalOrders = useMemo(
      () =>
        props.filteredProducts.reduce((sum, p) => {
          if (p.nmId === null) return sum;
          return sum + (props.orderCounts.get(p.nmId)?.ordersCount ?? 0);
        }, 0),
      [props.filteredProducts, props.orderCounts],
    );

    return (
      <section className="wb-card wb-card--wide">
        <div className="wb-workspace-header wb-workspace-header--products-list">
          <h2 className="wb-products-list-title">{`${ui.viewCatalogProducts} — ${props.productCatalogCount}`}</h2>
          <div className="wb-products-toolbar">
            <input
              className="wb-input wb-products-search"
              type="search"
              value={props.productsSearch}
              onChange={(e) => props.onProductsSearchChange(e.target.value)}
              placeholder={ui.productsSearchPlaceholder}
            />
          </div>
        </div>

        {props.hasCatalogItems ? (
          <div className="wb-products-page">
            <section className="wb-table-section">
              <div
                ref={tableWrapRef}
                className="wb-table-wrap--catalog-restricted"
                onScroll={(e) => {
                  saveScrollPosition(CATALOG_PRODUCTS_SCROLL_KEY, e.currentTarget.scrollTop);
                }}
              >
                <table
                  ref={tableRef}
                  className="wb-data-table wb-data-table--products"
                  style={{ tableLayout: "fixed", width: `${String(totalW)}px` }}
                >
                  <colgroup>
                    <col style={{ width: "48px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: `${String(nameColWidth)}px` }} />
                    <col style={{ width: `${String(CATEGORY_COL_WIDTH)}px` }} />
                    <col style={{ width: `${String(SUBJECT_COL_WIDTH)}px` }} />
                    <col style={{ width: `${String(COST_COL_WIDTH)}px` }} />
                    <col style={{ width: `${String(ORDERS_COL_WIDTH)}px` }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                        <button className="wb-products-sort-button" type="button" onClick={() => props.onProductsSortToggle("id")}>
                          <span>{ui.rowNumber}</span>
                          <SortArrow active={sortKey === "id"} direction={sortDir} />
                        </button>
                      </th>
                      <th style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                        <button className="wb-products-sort-button" type="button" onClick={() => props.onProductsSortToggle("id")}>
                          <span>{ui.productIdColumn}</span>
                          <SortArrow active={sortKey === "id"} direction={sortDir} />
                        </button>
                      </th>
                      <th style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                        <button className="wb-products-sort-button" type="button" onClick={() => props.onProductsSortToggle("name")}>
                          <span>{ui.productNameColumn}</span>
                          <SortArrow active={sortKey === "name"} direction={sortDir} />
                        </button>
                        <div className="wb-col-resize-handle" data-col-idx="2" onMouseDown={handleResizeMouseDown} />
                      </th>
                      <th style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                        <button className="wb-products-sort-button" type="button" onClick={() => props.onProductsSortToggle("category")}>
                          <span>{ui.category}</span>
                          <SortArrow active={sortKey === "category"} direction={sortDir} />
                        </button>
                        <div className="wb-col-resize-handle" data-col-idx="3" onMouseDown={handleResizeMouseDown} />
                      </th>
                      <th style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                        <button className="wb-products-sort-button" type="button" onClick={() => props.onProductsSortToggle("subject")}>
                          <span>{ui.subject}</span>
                          <SortArrow active={sortKey === "subject"} direction={sortDir} />
                        </button>
                        <div className="wb-col-resize-handle" data-col-idx="4" onMouseDown={handleResizeMouseDown} />
                      </th>
                      <th className="wb-table-cell--numeric" style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                        <button
                          className="wb-products-sort-button wb-cost-header-link"
                          type="button"
                          title="Открыть лист себестоимости на текущий день"
                          onClick={props.onOpenCostPriceSheet}
                        >
                          Себестоимость ↗
                        </button>
                      </th>
                      <th className="wb-table-cell--numeric" style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                        <button
                          className="wb-products-sort-button wb-cost-header-link"
                          type="button"
                          title="Открыть ретроспективу заказов"
                          onClick={props.onOpenOrdersSheet}
                        >
                          Заказы ↗
                        </button>
                      </th>
                      <th className="wb-table-cell--numeric" style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                        <button
                          className="wb-products-sort-button wb-cost-header-link"
                          type="button"
                          title="Открыть ретроспективу JAM (позиции в поиске)"
                          onClick={props.onOpenJamSheet}
                        >
                          JAM ↗
                        </button>
                      </th>
                      <th className="wb-table-cell--numeric" style={{ position: "sticky", top: 0, background: "var(--wb-table-header-bg)", zIndex: 3 }}>
                        <button
                          className="wb-products-sort-button wb-cost-header-link"
                          type="button"
                          title="Открыть ретроспективу остатков"
                          onClick={props.onOpenStocksSheet}
                        >
                          Остатки ↗
                        </button>
                      </th>
                    </tr>
                    {props.filteredProducts.length > 0 && (
                      <tr className="wb-products-totals-row wb-thead-row--second">
                        <th style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }} />
                        <th style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }} />
                        <th style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3, textAlign: "left", fontWeight: 700, color: "rgba(15,23,42,0.45)" }}>
                          Итого
                        </th>
                        <th style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }} />{/* Категория */}
                        <th style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }} />{/* Предмет */}
                        <th style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }} />{/* Себестоимость */}
                        <th className="wb-table-cell--numeric" style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }}>
                          {totalOrders > 0 ? String(totalOrders) : "—"}
                        </th>
                        <th style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }} />{/* JAM */}
                        <th style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }} />{/* Остатки */}
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {props.filteredProducts.length > 0 ? (
                      props.filteredProducts.map((product, index) => {
                        const cost = product.nmId !== null ? props.costPrices.get(product.nmId) : undefined;
                        const orders = product.nmId !== null ? props.orderCounts.get(product.nmId) : undefined;
                        const nmId = product.nmId;
                        const isSelected = nmId !== null && selectedNmIds.has(nmId);
                        const isEditing = nmId !== null && editingNmId === nmId;
                        return (
                          <tr key={`${product.vendorCode}-${nmId ?? "none"}`}>
                            <td className="wb-table-cell--numeric">{String(index + 1)}</td>
                            <td className="wb-table-cell--numeric">
                              {nmId === null ? "—" : String(nmId)}
                            </td>
                            <td>
                              <span
                                title={getDisplayVendorCode(product)}
                                style={{
                                  display: "block",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {getDisplayVendorCode(product)}
                              </span>
                            </td>
                            <td>{product.categoryName ?? "—"}</td>
                            <td>{product.subjectName ?? "—"}</td>
                            <td
                              className={`wb-table-cell--cost${isSelected ? " wb-table-cell--cost-selected" : ""}`}
                              onClick={nmId !== null ? (e) => handleCellClick(nmId, index, e) : undefined}
                              onDoubleClick={nmId !== null ? () => handleCellDoubleClick(nmId, index) : undefined}
                            >
                              {nmId !== null ? (
                                <CostInputCell
                                  nmId={nmId}
                                  savedValue={cost?.costValue ?? null}
                                  isSelected={isSelected}
                                  isEditing={isEditing}
                                  onSaved={props.onCostSaved}
                                  onCommitEdit={handleCommitEdit}
                                />
                              ) : "—"}
                            </td>
                            <td className="wb-table-cell--numeric wb-table-cell--orders">
                              {orders && orders.ordersCount > 0
                                ? String(orders.ordersCount)
                                : "—"}
                            </td>
                            <td className="wb-table-cell--numeric" style={{ color: "var(--wb-text-muted, #888)", fontSize: 11 }}>
                              ↗
                            </td>
                            <td className="wb-table-cell--numeric" style={{ color: "var(--wb-text-muted, #888)", fontSize: 11 }}>
                              ↗
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8}>{ui.noProductsFound}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : props.isCatalogLoading ? null : (
          <p className="wb-empty-copy">{ui.productsEmpty}</p>
        )}
      </section>
    );
  },
);
