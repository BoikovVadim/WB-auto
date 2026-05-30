import {
  cloneElement,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { ui } from "./copy";
import { loadScrollPosition, saveScrollPosition } from "./persistence/scrollPositionPersistence";
import { ProductsGridBodyRow, type GridColLayout } from "./ProductsGridRows";
import type { ProductsBodyRenderCtx } from "./ProductsTableBodyCells";
import {
  renderProductsHeaderCell,
  renderProductsTotalsCell,
  type ProductsHeaderRenderCtx,
} from "./ProductsTableHeadCells";
import { PRODUCTS_GRID_HEADER_ROW_H, PRODUCTS_GRID_ROW_H } from "./productsGridConstants";
import {
  productsTableColumnDefs,
  type ProductColumnDefinition,
  type ProductsColumnKey,
} from "./productsTableColumns";
import type { ProductsTableTotals } from "./useProductsTableTotals";
import { useFrozenPaneSync } from "./useFrozenPaneSync";
import type { ProductListItem } from "./useDashboardProductsWorkspace";

const CATALOG_PRODUCTS_SCROLL_KEY = "catalog-products-list";

// Левые колонки, закрепляемые слева (ведущий непрерывный префикс из этого набора).
const PINNED_COLUMN_KEYS: readonly ProductsColumnKey[] = ["index", "nmId", "vendorCode"];

const COL_MIN_WIDTH = 60;

const colDefByKey = new Map(productsTableColumnDefs.map((c) => [c.key, c]));

type GridCell = ReactElement<{ className?: string; style?: CSSProperties }>;

/** Клонирует ячейку шапки/тоталов с абсолютным позиционированием внутри своей зоны. */
function positionedHeaderCell(el: GridCell, key: string, left: number, width: number, top: number): GridCell {
  return cloneElement(el, {
    key,
    style: {
      ...el.props.style,
      position: "absolute",
      top,
      left,
      width,
      height: PRODUCTS_GRID_HEADER_ROW_H,
    },
  });
}

type ProductsTableGridProps = {
  products: ProductListItem[];
  orderedColumns: ProductColumnDefinition[];
  nameColWidth: number;
  /** Контекст шапки без onResizeMouseDown — ресайз инжектит сам grid (он владеет ширинами). */
  headerCtx: Omit<ProductsHeaderRenderCtx, "onResizeMouseDown">;
  bodyCtx: ProductsBodyRenderCtx;
  totals: ProductsTableTotals;
  hasTotalsRow: boolean;
  /** Ref на контейнер grid — нужен селекту строк (клик-вне/копирование). */
  containerRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * Frozen-pane grid таблицы товаров/юнит-экономики (тот же приём, что в
 * [VirtualMatrixTable](./VirtualMatrixTable.tsx), но под разнородные колонки с
 * редактируемыми ячейками и выделением строк). Закреплённые слева колонки —
 * отдельная зона на GPU-transform (НЕ position:sticky → нет paint каждый кадр).
 * Строки виртуализированы с фиксированной высотой (идеальное выравнивание зон,
 * без measureElement). Горизонтальный скролл — чистый compositor, без ре-рендера.
 */
export function ProductsTableGrid(props: ProductsTableGridProps) {
  const { products, orderedColumns, nameColWidth, headerCtx, bodyCtx, totals, hasTotalsRow, containerRef } = props;

  // ── Ширины колонок (ресайз) ──────────────────────────────────────────────
  // Эфемерны (как раньше DOM-ресайз): сбрасываются на remount. Хранятся в state,
  // чтобы grid пересчитал layout зон при перетаскивании края.
  const [colWidths, setColWidths] = useState<Partial<Record<ProductsColumnKey, number>>>({});

  const widthOf = useCallback(
    (key: ProductsColumnKey): number => {
      const override = colWidths[key];
      if (override !== undefined) return override;
      if (key === "vendorCode") return nameColWidth;
      return colDefByKey.get(key)?.defaultWidth ?? 100;
    },
    [colWidths, nameColWidth],
  );

  const startColumnResize = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const key = event.currentTarget.dataset.colKey as ProductsColumnKey | undefined;
      if (!key) return;
      const startX = event.clientX;
      const startW = widthOf(key);
      document.body.style.cursor = "col-resize";

      const onMove = (e: MouseEvent) => {
        const next = Math.max(COL_MIN_WIDTH, startW + (e.clientX - startX));
        setColWidths((prev) => ({ ...prev, [key]: next }));
      };
      const onUp = () => {
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp, { once: true });
    },
    [widthOf],
  );

  // ── Разбиение на закреплённую и скроллящуюся зоны + layout (left/width) ────
  const { pinnedLayout, scrollLayout, pinnedW, scrollW, hasPinned } = useMemo(() => {
    const pinned: GridColLayout[] = [];
    const scroll: GridColLayout[] = [];
    const w = (col: ProductColumnDefinition) =>
      colWidths[col.key] ?? (col.key === "vendorCode" ? nameColWidth : col.defaultWidth);

    let i = 0;
    let pl = 0;
    for (; i < orderedColumns.length; i++) {
      const col = orderedColumns[i];
      if (!col || !PINNED_COLUMN_KEYS.includes(col.key)) break;
      const width = w(col);
      pinned.push({ col, left: pl, width });
      pl += width;
    }
    let sl = 0;
    for (; i < orderedColumns.length; i++) {
      const col = orderedColumns[i];
      if (!col) continue;
      const width = w(col);
      scroll.push({ col, left: sl, width });
      sl += width;
    }
    return { pinnedLayout: pinned, scrollLayout: scroll, pinnedW: pl, scrollW: sl, hasPinned: pinned.length > 0 };
  }, [orderedColumns, colWidths, nameColWidth]);

  // ── Frozen-pane синхрон зон ──────────────────────────────────────────────
  const { bodyRef, headerInnerRef, leftInnerRef, setBodyRef, attachWheel, syncMirrors } = useFrozenPaneSync();

  const rowVirt = useVirtualizer({
    count: products.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => PRODUCTS_GRID_ROW_H,
    overscan: 12,
  });
  const rowItems = rowVirt.getVirtualItems();
  const totalH = rowVirt.getTotalSize();

  const HEADER_H = hasTotalsRow ? PRODUCTS_GRID_HEADER_ROW_H * 2 : PRODUCTS_GRID_HEADER_ROW_H;

  // ── Контекст шапки с инжектированным ресайзом (стабилен при скролле) ──────
  const effHeaderCtx = useMemo<ProductsHeaderRenderCtx>(
    () => ({ ...headerCtx, onResizeMouseDown: startColumnResize }),
    [headerCtx, startColumnResize],
  );

  const renderHeaderRegion = useCallback(
    (layout: GridColLayout[]): GridCell[] =>
      layout.flatMap(({ col, left, width }) => {
        const cells = [
          positionedHeaderCell(renderProductsHeaderCell(col, effHeaderCtx), `${col.key}-h`, left, width, 0),
        ];
        if (hasTotalsRow) {
          cells.push(
            positionedHeaderCell(
              renderProductsTotalsCell(col, totals),
              `${col.key}-t`,
              left,
              width,
              PRODUCTS_GRID_HEADER_ROW_H,
            ),
          );
        }
        return cells;
      }),
    [effHeaderCtx, totals, hasTotalsRow],
  );

  const pinnedHeaderContent = useMemo(() => renderHeaderRegion(pinnedLayout), [renderHeaderRegion, pinnedLayout]);
  const scrollHeaderContent = useMemo(() => renderHeaderRegion(scrollLayout), [renderHeaderRegion, scrollLayout]);

  // ── Скролл: синхрон зеркал + персист позиции (debounce внутри saveScrollPosition) ──
  const handleScroll = useCallback(() => {
    syncMirrors();
    const el = bodyRef.current;
    if (el) saveScrollPosition(CATALOG_PRODUCTS_SCROLL_KEY, el.scrollTop);
  }, [syncMirrors, bodyRef]);

  // Восстановление позиции скролла один раз, когда товары уже есть (иначе scrollTop
  // выставится до появления строк и схлопнется в 0).
  const restoredRef = useRef(false);
  useLayoutEffect(() => {
    if (restoredRef.current) return;
    const el = bodyRef.current;
    if (!el || products.length === 0) return;
    restoredRef.current = true;
    const target = loadScrollPosition(CATALOG_PRODUCTS_SCROLL_KEY);
    if (target > 0) {
      el.scrollTop = target;
      syncMirrors();
    }
  }, [products.length, syncMirrors, bodyRef]);

  const gridTemplateColumns = hasPinned ? `${String(pinnedW)}px 1fr` : "1fr";

  const renderBodyRows = (layout: GridColLayout[], regionWidth: number) =>
    rowItems.map((vr) => {
      const product = products[vr.index];
      if (!product) return null;
      return (
        <ProductsGridBodyRow
          key={`${product.vendorCode}-${product.nmId ?? "none"}`}
          top={vr.start}
          product={product}
          index={vr.index}
          layout={layout}
          regionWidth={regionWidth}
          bodyCtx={bodyCtx}
        />
      );
    });

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="wb-pg-grid"
      style={{ gridTemplateColumns, gridTemplateRows: `${String(HEADER_H)}px 1fr` }}
    >
      {/* (1,1) Угол: закреплённая шапка (+ Итого) — статична */}
      {hasPinned && (
        <div className="wb-pg-region wb-pg-region--pinned" ref={attachWheel}>
          {pinnedHeaderContent}
        </div>
      )}

      {/* (1,2) Шапка скроллящихся колонок — горизонтальное зеркало */}
      <div className="wb-pg-region" ref={attachWheel}>
        <div
          ref={headerInnerRef}
          style={{ width: scrollW, height: HEADER_H, position: "relative", willChange: "transform" }}
        >
          {scrollHeaderContent}
        </div>
      </div>

      {/* (2,1) Тело закреплённых колонок — вертикальное зеркало */}
      {hasPinned && (
        <div className="wb-pg-region wb-pg-region--pinned" ref={attachWheel}>
          <div
            ref={leftInnerRef}
            style={{ width: pinnedW, height: totalH, position: "relative", willChange: "transform" }}
          >
            {renderBodyRows(pinnedLayout, pinnedW)}
          </div>
        </div>
      )}

      {/* (2,2) Основное тело — единственная зона с нативным скроллом */}
      <div className="wb-pg-region wb-pg-region--body" ref={setBodyRef} onScroll={handleScroll}>
        <div style={{ width: scrollW, height: totalH, position: "relative" }}>
          {renderBodyRows(scrollLayout, scrollW)}
        </div>
        {products.length === 0 && <div className="wb-pg-empty">{ui.noProductsFound}</div>}
      </div>
    </div>
  );
}
