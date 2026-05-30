import { cloneElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { CostPriceCurrent } from "../../api/syncClientCostPrice";
import type { TodayOrderCount } from "../../api/syncClientOrders";
import type { TodayBuyoutCount } from "../../api/syncClientBuyouts";
import type { CurrentPriceEntry } from "./useCurrentPrices";
import type { PriceChangeStatus } from "../../api/syncClientPrices";
import { ui } from "./copy";
import {
  loadScrollPosition,
  saveScrollPosition,
} from "./persistence/scrollPositionPersistence";
import type { ProductColumnDefinition, ProductsColumnKey } from "./productsTableColumns";
import { useProductsColumnOrderState } from "./useProductsColumnOrderState";
import { useProductsColumnResize } from "./useProductsColumnResize";
import type { ProductListItem, ProductListSortKey } from "./useDashboardProductsWorkspace";
import { PriceConfirmModal } from "./ProductsTableCells";
import { getColWidth, getDisplayVendorCode } from "./productsTableHelpers";
import { sortProductsByLocalKey, type LocalSortKey } from "./productsTableSort";
import { useProductsTableSelection } from "./useProductsTableSelection";
import { useProductsTableTotals } from "./useProductsTableTotals";
import {
  renderProductsHeaderCell,
  renderProductsTotalsCell,
  type ProductsHeaderRenderCtx,
} from "./ProductsTableHeadCells";
import { renderProductsBodyCell, type ProductsBodyRenderCtx } from "./ProductsTableBodyCells";

export type { CostPriceCurrent };
export type { CurrentPriceEntry };

const CATALOG_PRODUCTS_SCROLL_KEY = "catalog-products-list";

// Левые колонки, закреплённые при горизонтальном скролле (как №/ID/Название в
// ретроспективах). Закрепляем только ведущий непрерывный префикс из этого набора —
// если пользователь перетащит между ними обычную колонку, закрепление аккуратно
// прекратится, без визуальных нахлёстов.
const PINNED_COLUMN_KEYS: readonly ProductsColumnKey[] = ["index", "nmId", "vendorCode"];

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
  buyoutCounts: Map<number, TodayBuyoutCount>;
  rollingBuyoutCounts: Map<number, TodayBuyoutCount>;
  stockCounts: Map<number, number>;
  priceCounts: Map<number, CurrentPriceEntry>;
  ordersSumValues: Map<number, number>;
  revenueValues: Map<number, number>;
  costSumValues: Map<number, number>;
  adSpendValues: Map<number, number>;
  sppValues: Map<number, number>;
  /** Налог в ₽ на товар (глобальный %) — только «Юнит Экономика». Считается на бэке. */
  taxValues: Map<number, number>;
  /** Комиссия в ₽ на товар (по категории) — только «Юнит Экономика». Считается на бэке. */
  commissionValues: Map<number, number>;
  /** Эквайринг в ₽ на товар (применённый %) — только «Юнит Экономика». Считается на бэке. */
  acquiringValues: Map<number, number>;
  /** Применённый % эквайринга на товар (факт за неделю или ручной) — только «Юнит Экономика». */
  acquiringPercentValues: Map<number, number>;
  /** nmId с фактическим % эквайринга (остальные — ручной fallback, рисуются приглушённо). */
  acquiringFactualSet: Set<number>;
  /** ДРР в ₽ на товар (глобальный %) — только «Юнит Экономика». Считается на бэке. */
  drrValues: Map<number, number>;
  /** Маржа в ₽ на единицу — только «Юнит Экономика». Считается на бэке. */
  marginRubValues: Map<number, number>;
  /** Маржа в % к цене со скидкой — только «Юнит Экономика». Считается на бэке. */
  marginPercentValues: Map<number, number>;
  priceChangeStatuses: Map<number, PriceChangeStatus>;
  /** Колонки, скрытые в этой секции. Напр. «Юнит Экономика» прячет
   *  заказы/остатки/сумму заказов/выручку/с-с продаж/рекламу. */
  hiddenColumns?: ProductsColumnKey[];
  onProductsSearchChange: (value: string) => void;
  onProductsSortToggle: (key: ProductListSortKey) => void;
  onOpenCostPriceSheet: () => void;
  onOpenOrdersSheet: () => void;
  onOpenBuyoutSheet: () => void;
  onOpenStocksSheet: () => void;
  onOpenPricesSheet: () => void;
  onOpenOrdersSumSheet: () => void;
  onOpenRevenueSheet: () => void;
  onOpenCostSumSheet: () => void;
  onOpenAdSpendSheet: () => void;
  onOpenSppSheet: () => void;
  onOpenAcquiringSheet: () => void;
  onCostSaved: (nmId: number, value: number) => Promise<void>;
  onCostCleared: (nmIds: number[]) => Promise<void>;
  /** ⚠️ Запись новой цены «со скидкой» на маркетплейс WB. */
  onPriceSaved: (nmId: number, targetFinal: number) => Promise<void>;
};

// ─── Main component ───────────────────────────────────────────────────────────

export const DashboardCatalogProductsSection = memo(
  function DashboardCatalogProductsSection(props: DashboardCatalogProductsSectionProps) {
    const tableWrapRef = useRef<HTMLDivElement | null>(null);
    const tableRef = useRef<HTMLTableElement | null>(null);

    // ── Column ordering (drag-and-drop) ────────────────────────────────────────
    const { draggedColumn, orderedColumns: allOrderedColumns, setDraggedColumn, handleDrop } =
      useProductsColumnOrderState();
    // Скрытые в этой секции колонки (порядок/ширины храним общими, фильтруем только показ).
    const hiddenColumns = props.hiddenColumns;
    const orderedColumns = useMemo(
      () =>
        hiddenColumns && hiddenColumns.length > 0
          ? allOrderedColumns.filter((c) => !hiddenColumns.includes(c.key))
          : allOrderedColumns,
      [allOrderedColumns, hiddenColumns],
    );

    // ── Local sort (for cost/orders/stock columns) ──────────────────────────────
    const [localSortKey, setLocalSortKey] = useState<LocalSortKey | null>(null);
    const [localSortDir, setLocalSortDir] = useState<"asc" | "desc">("desc");

    // Reset local sort when parent sort changes
    const prevParentSortKey = useRef(props.productsSortKey);
    useEffect(() => {
      if (props.productsSortKey !== prevParentSortKey.current) {
        prevParentSortKey.current = props.productsSortKey;
        setLocalSortKey(null);
      }
    }, [props.productsSortKey]);

    const handleLocalSortToggle = useCallback((key: LocalSortKey) => {
      setLocalSortKey((prev) => {
        if (prev === key) {
          setLocalSortDir((d) => (d === "asc" ? "desc" : "asc"));
          return key;
        }
        setLocalSortDir("desc");
        return key;
      });
    }, []);

    const handleParentSortToggle = useCallback(
      (key: ProductListSortKey) => {
        setLocalSortKey(null);
        props.onProductsSortToggle(key);
      },
      [props],
    );

    // Products sorted by local sort (if active), otherwise parent-sorted list (см. productsTableSort).
    const displayProducts = useMemo(
      () =>
        sortProductsByLocalKey(props.filteredProducts, localSortKey, localSortDir, {
          costPrices: props.costPrices,
          orderCounts: props.orderCounts,
          rollingBuyoutCounts: props.rollingBuyoutCounts,
          stockCounts: props.stockCounts,
          priceCounts: props.priceCounts,
          ordersSumValues: props.ordersSumValues,
          revenueValues: props.revenueValues,
          costSumValues: props.costSumValues,
          adSpendValues: props.adSpendValues,
          sppValues: props.sppValues,
          commissionValues: props.commissionValues,
          taxValues: props.taxValues,
          acquiringValues: props.acquiringValues,
          acquiringPercentValues: props.acquiringPercentValues,
          drrValues: props.drrValues,
          marginRubValues: props.marginRubValues,
          marginPercentValues: props.marginPercentValues,
        }),
      [props.filteredProducts, localSortKey, localSortDir, props.orderCounts, props.rollingBuyoutCounts, props.stockCounts, props.ordersSumValues, props.revenueValues, props.costSumValues, props.adSpendValues, props.sppValues, props.commissionValues, props.taxValues, props.acquiringValues, props.acquiringPercentValues, props.drrValues, props.marginRubValues, props.marginPercentValues, props.costPrices, props.priceCounts],
    );

    // Выделение строк + inline-редактирование (себестоимость/цена) — см. useProductsTableSelection.
    const {
      selectedNmIds,
      editingNmId,
      editingPriceNmId,
      priceConfirm,
      handleCommitEdit,
      handleStartEdit,
      handleStartPriceEdit,
      handleCommitPriceEdit,
      handleRequestPriceConfirm,
      handleCancelPriceConfirm,
      handleConfirmPrice,
      handleCellClick,
      handleCellDoubleClick,
    } = useProductsTableSelection({
      displayProducts,
      tableRef,
      onCostCleared: props.onCostCleared,
      onPriceSaved: props.onPriceSaved,
    });

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

    const totalW = useMemo(
      () => orderedColumns.reduce((sum, col) => sum + getColWidth(col, nameColWidth), 0),
      [orderedColumns, nameColWidth],
    );

    // ── Закрепление левых колонок (sticky) ───────────────────────────────────────
    // Считаем left-офсет для каждой закреплённой колонки из ведущего префикса
    // PINNED_COLUMN_KEYS; lastPinnedKey — для разделительной тени справа.
    const { pinnedLeftByKey, lastPinnedKey } = useMemo(() => {
      const map = new Map<ProductsColumnKey, number>();
      let left = 0;
      let last: ProductsColumnKey | null = null;
      for (const col of orderedColumns) {
        if (!PINNED_COLUMN_KEYS.includes(col.key)) break;
        map.set(col.key, left);
        left += getColWidth(col, nameColWidth);
        last = col.key;
      }
      return { pinnedLeftByKey: map, lastPinnedKey: last };
    }, [orderedColumns, nameColWidth]);

    // Применяет sticky-класс + left-офсет к уже отрендеренной ячейке колонки (th/td),
    // не трогая switch'и рендереров. Фоны закреплённых ячеек задаёт класс
    // .wb-table-cell--sticky-left (header/totals/body — каждый со своим фоном).
    const withPin = useCallback(
      (
        col: ProductColumnDefinition,
        el: ReactElement<{ className?: string; style?: React.CSSProperties }> | undefined,
      ) => {
        if (!el) return el;
        const left = pinnedLeftByKey.get(col.key);
        if (left === undefined) return el;
        const className = [
          el.props.className,
          "wb-table-cell--sticky-left",
          col.key === lastPinnedKey ? "wb-table-cell--sticky-left-last" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return cloneElement(el, { className, style: { ...el.props.style, left } });
      },
      [pinnedLeftByKey, lastPinnedKey],
    );

    // Ресайз колонок мышью (тянуть правый край заголовка) — см. useProductsColumnResize.
    const handleResizeMouseDown = useProductsColumnResize(tableRef);

    useLayoutEffect(() => {
      const el = tableWrapRef.current;
      if (!el) return;
      const target = loadScrollPosition(CATALOG_PRODUCTS_SCROLL_KEY);
      if (target > 0) el.scrollTop = target;
    }, [props.hasCatalogItems]);

    // ── Виртуализация строк ──────────────────────────────────────────────────────
    // Рендерим только видимые строки (тот же приём, что в ретроспективах), НЕ трогая
    // разметку ячеек, редактирование себестоимости, drag-reorder, выделение и
    // сортировки — поэтому регрессий нет, а скролл/сортировка/поиск становятся
    // мгновенными при сотнях товаров. Высоту строк измеряем динамически
    // (measureElement), чтобы скролл не «уплывал».
    const rowVirtualizer = useVirtualizer({
      count: displayProducts.length,
      getScrollElement: () => tableWrapRef.current,
      estimateSize: () => 26,
      overscan: 14,
    });
    const virtualRows = rowVirtualizer.getVirtualItems();
    const virtualTotalSize = rowVirtualizer.getTotalSize();
    const padTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
    const padBottom =
      virtualRows.length > 0
        ? virtualTotalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
        : 0;

    const { productsSortKey: sortKey, productsSortDirection: sortDir } = props;

    const totals = useProductsTableTotals({
      filteredProducts: props.filteredProducts,
      orderCounts: props.orderCounts,
      rollingBuyoutCounts: props.rollingBuyoutCounts,
      stockCounts: props.stockCounts,
      ordersSumValues: props.ordersSumValues,
      revenueValues: props.revenueValues,
      costSumValues: props.costSumValues,
      adSpendValues: props.adSpendValues,
      commissionValues: props.commissionValues,
      taxValues: props.taxValues,
      acquiringValues: props.acquiringValues,
      drrValues: props.drrValues,
      marginRubValues: props.marginRubValues,
      priceCounts: props.priceCounts,
      sppValues: props.sppValues,
    });

    // ── Контекст для вынесенных рендереров шапки/тела ───────────────────────────
    const headerCtx: ProductsHeaderRenderCtx = {
      localSortKey,
      localSortDir,
      parentSortKey: sortKey,
      parentSortDir: sortDir,
      draggedColumn,
      onParentSort: handleParentSortToggle,
      onLocalSort: handleLocalSortToggle,
      onDragStart: setDraggedColumn,
      onDragEnd: () => setDraggedColumn(null),
      onDrop: handleDrop,
      onResizeMouseDown: handleResizeMouseDown,
      sheets: {
        cost: props.onOpenCostPriceSheet,
        price: props.onOpenPricesSheet,
        orders: props.onOpenOrdersSheet,
        buyout: props.onOpenBuyoutSheet,
        spp: props.onOpenSppSheet,
        stock: props.onOpenStocksSheet,
        ordersSum: props.onOpenOrdersSumSheet,
        revenue: props.onOpenRevenueSheet,
        costSum: props.onOpenCostSumSheet,
        adSpend: props.onOpenAdSpendSheet,
        acquiring: props.onOpenAcquiringSheet,
      },
    };

    const bodyCtx: ProductsBodyRenderCtx = {
      costPrices: props.costPrices,
      orderCounts: props.orderCounts,
      rollingBuyoutCounts: props.rollingBuyoutCounts,
      stockCounts: props.stockCounts,
      priceCounts: props.priceCounts,
      ordersSumValues: props.ordersSumValues,
      revenueValues: props.revenueValues,
      costSumValues: props.costSumValues,
      adSpendValues: props.adSpendValues,
      sppValues: props.sppValues,
      commissionValues: props.commissionValues,
      taxValues: props.taxValues,
      acquiringValues: props.acquiringValues,
      acquiringPercentValues: props.acquiringPercentValues,
      acquiringFactualSet: props.acquiringFactualSet,
      drrValues: props.drrValues,
      marginRubValues: props.marginRubValues,
      marginPercentValues: props.marginPercentValues,
      priceChangeStatuses: props.priceChangeStatuses,
      selectedNmIds,
      editingNmId,
      editingPriceNmId,
      onCellClick: handleCellClick,
      onCellDoubleClick: handleCellDoubleClick,
      onCostSaved: props.onCostSaved,
      onCommitEdit: handleCommitEdit,
      onStartEdit: handleStartEdit,
      onStartPriceEdit: handleStartPriceEdit,
      onCommitPriceEdit: handleCommitPriceEdit,
      onRequestPriceConfirm: handleRequestPriceConfirm,
    };

    // ── Render ─────────────────────────────────────────────────────────────────

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
                    {orderedColumns.map((col) => (
                      <col
                        key={col.key}
                        style={{ width: `${String(getColWidth(col, nameColWidth))}px` }}
                      />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      {orderedColumns.map((col, colIdx) => withPin(col, renderProductsHeaderCell(col, colIdx, headerCtx)))}
                    </tr>
                    {displayProducts.length > 0 && (
                      <tr className="wb-products-totals-row wb-thead-row--second">
                        {orderedColumns.map((col) => withPin(col, renderProductsTotalsCell(col, totals)))}
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {displayProducts.length > 0 ? (
                      <>
                        {padTop > 0 && (
                          <tr aria-hidden>
                            <td colSpan={orderedColumns.length} style={{ height: padTop, padding: 0, border: 0 }} />
                          </tr>
                        )}
                        {virtualRows.map((vRow) => {
                          const product = displayProducts[vRow.index];
                          if (!product) return null;
                          return (
                            <tr
                              key={`${product.vendorCode}-${product.nmId ?? "none"}`}
                              data-index={vRow.index}
                              ref={rowVirtualizer.measureElement}
                            >
                              {orderedColumns.map((col) => withPin(col, renderProductsBodyCell(col, product, vRow.index, bodyCtx)))}
                            </tr>
                          );
                        })}
                        {padBottom > 0 && (
                          <tr aria-hidden>
                            <td colSpan={orderedColumns.length} style={{ height: padBottom, padding: 0, border: 0 }} />
                          </tr>
                        )}
                      </>
                    ) : (
                      <tr>
                        <td colSpan={orderedColumns.length}>{ui.noProductsFound}</td>
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

        {priceConfirm && (() => {
          const e = props.priceCounts.get(priceConfirm.nmId);
          const d = e?.discount ?? 0;
          const base = Math.round(priceConfirm.target / (1 - d / 100));
          // Фактическая цена «со скидкой», которую установит WB: целая база × скидка,
          // получается с копейками. Показываем именно её, а не округлённое введённое.
          const shelf = Math.round(base * (1 - d / 100) * 100) / 100;
          const overlay = props.priceChangeStatuses.get(priceConfirm.nmId);
          const oldFinal = overlay ? overlay.desiredFinal : (e?.priceWithDiscount ?? null);
          const product = props.filteredProducts.find((p) => p.nmId === priceConfirm.nmId);
          const label = product ? getDisplayVendorCode(product) : `#${String(priceConfirm.nmId)}`;
          return (
            <PriceConfirmModal
              productLabel={label}
              oldFinal={oldFinal}
              shelf={shelf}
              onConfirm={() => { void handleConfirmPrice(); }}
              onCancel={handleCancelPriceConfirm}
            />
          );
        })()}
      </section>
    );
  },
);
