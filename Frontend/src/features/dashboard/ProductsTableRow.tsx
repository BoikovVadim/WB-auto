import { memo, type CSSProperties, type ReactElement } from "react";

import { renderProductsBodyCell, type ProductsBodyRenderCtx } from "./ProductsTableBodyCells";
import type { ProductColumnDefinition } from "./productsTableColumns";
import type { ProductListItem } from "./useDashboardProductsWorkspace";

type PinnableCell = ReactElement<{ className?: string; style?: CSSProperties }>;

type ProductsTableRowProps = {
  product: ProductListItem;
  index: number;
  orderedColumns: ProductColumnDefinition[];
  bodyCtx: ProductsBodyRenderCtx;
  /** Накладывает sticky-класс/left-офсет на закреплённые ячейки (см. withPin в секции). */
  withPin: (col: ProductColumnDefinition, el: PinnableCell | undefined) => PinnableCell | undefined;
};

/**
 * Одна строка тела таблицы товаров/юнит-экономики. Обёрнута в memo: при вертикальном
 * скролле виртуализатор каждый кадр пересоздаёт обёртки <tr>, но props конкретной
 * строки (product, index, порядок колонок, СТАБИЛЬНЫЙ bodyCtx, стабильный withPin)
 * при скролле не меняются — значит ячейки этой строки НЕ переотрисовываются.
 *
 * Без memo на каждую смену окна (каждые ~26px) заново строились все видимые ячейки
 * (~30 строк × ~18 колонок ≈ 540 элементов) → главный поток не успевал, строки
 * «пропадали» и появлялись с задержкой. С memo рендерятся только реально входящие
 * в окно строки (1–3), а не все видимые.
 */
export const ProductsTableRow = memo(function ProductsTableRow({
  product,
  index,
  orderedColumns,
  bodyCtx,
  withPin,
}: ProductsTableRowProps) {
  return (
    <>
      {orderedColumns.map((col) => withPin(col, renderProductsBodyCell(col, product, index, bodyCtx)))}
    </>
  );
});
