import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CostPriceCurrent } from "../../api/syncClientCostPrice";
import type { TodayOrderCount } from "../../api/syncClientOrders";
import type { TodayBuyoutCount } from "../../api/syncClientBuyouts";
import type { CurrentPriceEntry } from "./useCurrentPrices";
import type { PriceChangeStatus } from "../../api/syncClientPrices";
import { ui } from "./copy";
import type { ProductsColumnKey } from "./productsTableColumns";
import { useProductsColumnOrderState } from "./useProductsColumnOrderState";
import type { ProductListItem, ProductListSortKey } from "./useDashboardProductsWorkspace";
import { PriceConfirmModal } from "./ProductsTableCells";
import { getDisplayVendorCode } from "./productsTableHelpers";
import { sortProductsByLocalKey, type LocalSortKey } from "./productsTableSort";
import { useProductsTableSelection } from "./useProductsTableSelection";
import { useProductsTableTotals } from "./useProductsTableTotals";
import type { ProductsHeaderRenderCtx } from "./ProductsTableHeadCells";
import { ProductsTableGrid } from "./ProductsTableGrid";
import { useProductsBodyCtx } from "./useProductsBodyCtx";

export type { CostPriceCurrent };
export type { CurrentPriceEntry };

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
    // Ref на контейнер grid — нужен селекту строк (клик-вне/Ctrl+C/Esc).
    const containerRef = useRef<HTMLDivElement | null>(null);

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

    const { onProductsSortToggle } = props;
    const handleParentSortToggle = useCallback(
      (key: ProductListSortKey) => {
        setLocalSortKey(null);
        onProductsSortToggle(key);
      },
      [onProductsSortToggle],
    );
    const handleDragEnd = useCallback(() => setDraggedColumn(null), [setDraggedColumn]);

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
    // Объект целиком передаём в useProductsBodyCtx; отдельные поля нужны только модалке цены.
    const selection = useProductsTableSelection({
      displayProducts,
      tableRef: containerRef,
      onCostCleared: props.onCostCleared,
      onPriceSaved: props.onPriceSaved,
    });
    const { priceConfirm, handleCancelPriceConfirm, handleConfirmPrice } = selection;

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

    // ── Контекст шапки (стабилен при скролле → шапка grid не переотрисовывается).
    // onResizeMouseDown инжектит сам grid (он владеет ширинами колонок). ──────────
    const headerCtx = useMemo<Omit<ProductsHeaderRenderCtx, "onResizeMouseDown">>(
      () => ({
        localSortKey,
        localSortDir,
        parentSortKey: props.productsSortKey,
        parentSortDir: props.productsSortDirection,
        draggedColumn,
        onParentSort: handleParentSortToggle,
        onLocalSort: handleLocalSortToggle,
        onDragStart: setDraggedColumn,
        onDragEnd: handleDragEnd,
        onDrop: handleDrop,
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
      }),
      [
        localSortKey,
        localSortDir,
        props.productsSortKey,
        props.productsSortDirection,
        draggedColumn,
        handleParentSortToggle,
        handleLocalSortToggle,
        setDraggedColumn,
        handleDragEnd,
        handleDrop,
        props.onOpenCostPriceSheet,
        props.onOpenPricesSheet,
        props.onOpenOrdersSheet,
        props.onOpenBuyoutSheet,
        props.onOpenSppSheet,
        props.onOpenStocksSheet,
        props.onOpenOrdersSumSheet,
        props.onOpenRevenueSheet,
        props.onOpenCostSumSheet,
        props.onOpenAdSpendSheet,
        props.onOpenAcquiringSheet,
      ],
    );

    // Стабильный (memo) контекст рендера ячеек — см. useProductsBodyCtx.
    const bodyCtx = useProductsBodyCtx(props, selection);

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
              <ProductsTableGrid
                products={displayProducts}
                orderedColumns={orderedColumns}
                nameColWidth={nameColWidth}
                headerCtx={headerCtx}
                bodyCtx={bodyCtx}
                totals={totals}
                hasTotalsRow={displayProducts.length > 0}
                containerRef={containerRef}
              />
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
