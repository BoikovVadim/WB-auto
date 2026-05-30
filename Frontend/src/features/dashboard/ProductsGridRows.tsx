import { cloneElement, memo, type CSSProperties } from "react";

import { renderProductsBodyCell, type ProductsBodyRenderCtx } from "./ProductsTableBodyCells";
import { PRODUCTS_GRID_ROW_H } from "./productsGridConstants";
import type { ProductColumnDefinition } from "./productsTableColumns";
import type { ProductListItem } from "./useDashboardProductsWorkspace";

/** Колонка с уже посчитанным left-офсетом и шириной внутри своей зоны. */
export type GridColLayout = { col: ProductColumnDefinition; left: number; width: number };

type ProductsGridBodyRowProps = {
  /** Абсолютный top строки = index * ROW_H (стабилен при скролле). */
  top: number;
  product: ProductListItem;
  index: number;
  layout: GridColLayout[];
  /** Ширина зоны (закреплённой или скроллящейся) — ширина строки-контейнера. */
  regionWidth: number;
  bodyCtx: ProductsBodyRenderCtx;
};

/**
 * Одна строка тела одной зоны (закреплённой ИЛИ скроллящейся) frozen-pane grid.
 * Обёрнута в memo: при вертикальном скролле top конкретного товара постоянен
 * (= index*ROW_H), а layout/bodyCtx стабильны → строка НЕ переотрисовывается;
 * рендерятся только реально входящие в окно строки. Горизонтальный скролл вообще
 * не вызывает ре-рендер (ячейки позиционированы абсолютно, двигает их нативный
 * скролл контейнера/transform шапки). Это и даёт «лёгкую» таблицу.
 */
export const ProductsGridBodyRow = memo(function ProductsGridBodyRow({
  top,
  product,
  index,
  layout,
  regionWidth,
  bodyCtx,
}: ProductsGridBodyRowProps) {
  return (
    <div style={{ position: "absolute", top, left: 0, width: regionWidth, height: PRODUCTS_GRID_ROW_H }}>
      {layout.map(({ col, left, width }) => {
        const cell = renderProductsBodyCell(col, product, index, bodyCtx);
        if (!cell) return null;
        const posStyle: CSSProperties = {
          ...cell.props.style,
          position: "absolute",
          top: 0,
          left,
          width,
          height: PRODUCTS_GRID_ROW_H,
        };
        return cloneElement(cell, { key: col.key, style: posStyle });
      })}
    </div>
  );
});
