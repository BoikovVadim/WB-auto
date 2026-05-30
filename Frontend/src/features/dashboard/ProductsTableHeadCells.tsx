import type { CSSProperties, ReactElement } from "react";

import { formatMoney, formatPercent } from "../../formatters";
import { SortArrow } from "./ProductsTableCells";
import type { ProductColumnDefinition, ProductsColumnKey } from "./productsTableColumns";
import { getColLabel, getParentSortKey } from "./productsTableHelpers";
import type { LocalSortKey } from "./productsTableSort";
import type { ProductsTableTotals } from "./useProductsTableTotals";
import type { ProductListSortKey } from "./useDashboardProductsWorkspace";

export type ProductsHeaderRenderCtx = {
  localSortKey: LocalSortKey | null;
  localSortDir: "asc" | "desc";
  parentSortKey: ProductListSortKey;
  parentSortDir: "asc" | "desc";
  draggedColumn: ProductsColumnKey | null;
  onParentSort: (key: ProductListSortKey) => void;
  onLocalSort: (key: LocalSortKey) => void;
  onDragStart: (key: ProductsColumnKey) => void;
  onDragEnd: () => void;
  onDrop: (event: React.DragEvent<HTMLElement>, key: ProductsColumnKey) => void;
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  sheets: {
    cost: () => void;
    price: () => void;
    orders: () => void;
    buyout: () => void;
    spp: () => void;
    stock: () => void;
    ordersSum: () => void;
    revenue: () => void;
    costSum: () => void;
    adSpend: () => void;
    drrPercent: () => void;
    acquiring: () => void;
    marginRub: () => void;
    marginPercent: () => void;
  };
};

// Ячейка grid-таблицы: <div> с className/style (grid дорисовывает позиционирование клоном).
type GridCell = ReactElement<{ className?: string; style?: CSSProperties }>;

/**
 * Заголовок столбца таблицы товаров. Левые (index/nmId/vendorCode/category/subject) —
 * parent-сортировка; метрики с ретроспективой — клик по названию открывает лист, по
 * стрелке сортирует; read-only метрики (комиссия/эквайринг/ДРР) — только сортировка.
 */
export function renderProductsHeaderCell(
  col: ProductColumnDefinition,
  ctx: ProductsHeaderRenderCtx,
): GridCell {
  const key = col.key;
  const parentSortKey = getParentSortKey(key);
  const isParentActive =
    ctx.localSortKey === null && parentSortKey !== null && ctx.parentSortKey === parentSortKey;
  const isLocalActive = ctx.localSortKey === key;
  const isDragging = ctx.draggedColumn === key;

  const dragHandlers = {
    draggable: true as const,
    onDragStart: (e: React.DragEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).closest(".wb-col-resize-handle")) {
        e.preventDefault();
        return;
      }
      ctx.onDragStart(key);
    },
    onDragEnd: () => ctx.onDragEnd(),
    onDragOver: (e: React.DragEvent<HTMLElement>) => e.preventDefault(),
    onDrop: (e: React.DragEvent<HTMLElement>) => ctx.onDrop(e, key),
  };

  // Заголовок столбца с ретроспективой: клик по названию открывает лист, по стрелке — сортирует.
  const renderSheetHeader = (
    label: string,
    localKey: LocalSortKey,
    onOpenSheet: () => void,
    sheetTitle: string,
  ) => (
    <div className="wb-products-col-header-split">
      <button className="wb-products-header-sheet-btn" type="button" title={sheetTitle} onClick={onOpenSheet}>
        <span>{label}</span>
      </button>
      <button
        className="wb-products-header-sort-btn"
        type="button"
        title="Сортировать"
        onClick={() => ctx.onLocalSort(localKey)}
      >
        <SortArrow active={isLocalActive} direction={ctx.localSortDir} />
      </button>
    </div>
  );

  // Заголовок read-only колонки без ретроспективы (комиссия/эквайринг/ДРР): клик = сортировка.
  const renderSortOnlyHeader = (label: string, localKey: LocalSortKey) => (
    <button className="wb-products-sort-button" type="button" onClick={() => ctx.onLocalSort(localKey)}>
      <span>{label}</span>
      <SortArrow active={isLocalActive} direction={ctx.localSortDir} />
    </button>
  );

  // Заголовок-метка без сортировки (колонки-вводы калькулятора): сортировать по своему
  // же черновику смысла нет — только подпись (drag/reorder работает через внешний div).
  const renderPlainHeader = (label: string) => (
    <span className="wb-products-plain-header">{label}</span>
  );

  const renderParentHeader = (parentKey: ProductListSortKey, withResize: boolean) => (
    <>
      <button className="wb-products-sort-button" type="button" onClick={() => ctx.onParentSort(parentKey)}>
        <span>{getColLabel(key)}</span>
        <SortArrow active={isParentActive} direction={ctx.parentSortDir} />
      </button>
      {withResize && (
        <div className="wb-col-resize-handle" data-col-key={key} onMouseDown={ctx.onResizeMouseDown} />
      )}
    </>
  );

  const content = (() => {
    switch (key) {
      case "index":
      case "nmId":
        return renderParentHeader("id", false);
      case "vendorCode":
        return renderParentHeader("name", true);
      case "category":
        return renderParentHeader("category", true);
      case "subject":
        return renderParentHeader("subject", true);
      case "cost":
        return renderSheetHeader("Себестоимость", "cost", ctx.sheets.cost, "Открыть лист себестоимости");
      case "price":
        return renderSheetHeader("Цена", "price", ctx.sheets.price, "Открыть ретроспективу цен");
      case "commission":
        return renderSortOnlyHeader("Комиссия", "commission");
      case "tax":
        return renderSortOnlyHeader("Налог", "tax");
      case "acquiring":
        return renderSortOnlyHeader("Эквайринг, ₽", "acquiring");
      case "acquiringPercent":
        return renderSheetHeader(
          "Эквайринг, %",
          "acquiringPercent",
          ctx.sheets.acquiring,
          "Открыть ретроспективу эквайринга по неделям",
        );
      case "drr":
        return renderSortOnlyHeader("ДРР", "drr");
      case "marginRub":
        return renderSheetHeader("Маржа, ₽", "marginRub", ctx.sheets.marginRub, "Открыть ретроспективу маржи, ₽");
      case "marginPercent":
        return renderSheetHeader("Маржа, %", "marginPercent", ctx.sheets.marginPercent, "Открыть ретроспективу маржи, %");
      case "targetMargin":
        return renderPlainHeader("Целевая маржа, %");
      case "priceForMargin":
        return renderSortOnlyHeader("Цена для маржи, ₽", "priceForMargin");
      case "priceInput":
        return renderPlainHeader("Цена, ₽");
      case "marginForPrice":
        return renderSortOnlyHeader("Маржа при цене, %", "marginForPrice");
      case "orders":
        return renderSheetHeader("Заказы", "orders", ctx.sheets.orders, "Открыть ретроспективу заказов");
      case "buyout":
        return renderSheetHeader("% выкупа", "buyout", ctx.sheets.buyout, "Открыть ретроспективу % выкупа");
      case "spp":
        return renderSheetHeader("СПП", "spp", ctx.sheets.spp, "Открыть ретроспективу СПП");
      case "stock":
        return renderSheetHeader("Остатки", "stock", ctx.sheets.stock, "Открыть ретроспективу остатков");
      case "ordersSum":
        return renderSheetHeader("Сумма заказов", "ordersSum", ctx.sheets.ordersSum, "Открыть ретроспективу суммы заказов");
      case "revenue":
        return renderSheetHeader("Выручка", "revenue", ctx.sheets.revenue, "Открыть ретроспективу выручки");
      case "costSum":
        return renderSheetHeader("С/с продаж", "costSum", ctx.sheets.costSum, "Открыть ретроспективу С/с продаж");
      case "adSpend":
        return renderSheetHeader("Реклама", "adSpend", ctx.sheets.adSpend, "Открыть ретроспективу расходов на рекламу");
      case "drrPercent":
        return renderSheetHeader("ДРР, %", "drrPercent", ctx.sheets.drrPercent, "Открыть ретроспективу ДРР (расход / выручка)");
    }
  })();

  return (
    <div
      key={key}
      className={`wb-pg-head${isDragging ? " wb-products-column--dragging" : ""}`}
      {...dragHandlers}
    >
      {content}
    </div>
  );
}

/** Ячейка строки «Итого» (вторая строка шапки). Значения берутся из totals. */
export function renderProductsTotalsCell(
  col: ProductColumnDefinition,
  totals: ProductsTableTotals,
): GridCell {
  const key = col.key;
  const moneyCell = (value: number | null) => (
    <div key={key} className="wb-pg-total wb-pg-total--num">
      {value !== null ? formatMoney(value) : "—"}
    </div>
  );

  switch (key) {
    case "vendorCode":
      return (
        <div key={key} className="wb-pg-total wb-pg-total--label">
          Итого
        </div>
      );
    case "orders":
      return (
        <div key={key} className="wb-pg-total wb-pg-total--num">
          {totals.totalOrders > 0 ? String(totals.totalOrders) : "—"}
        </div>
      );
    case "buyout":
      return <div key={key} className="wb-pg-total wb-pg-total--num">{formatPercent(totals.totalBuyoutPercent)}</div>;
    case "spp":
      return <div key={key} className="wb-pg-total wb-pg-total--num">{formatPercent(totals.totalSpp)}</div>;
    case "stock":
      return (
        <div key={key} className="wb-pg-total wb-pg-total--num">
          {totals.totalStocks !== null ? String(totals.totalStocks) : "—"}
        </div>
      );
    case "commission":
      return moneyCell(totals.totalCommission);
    case "tax":
      return moneyCell(totals.totalTax);
    case "acquiring":
      return moneyCell(totals.totalAcquiring);
    case "acquiringPercent":
      return (
        <div key={key} className="wb-pg-total wb-pg-total--num">
          {totals.totalAcquiringPercent !== null ? formatPercent(totals.totalAcquiringPercent) : "—"}
        </div>
      );
    case "drr":
      return moneyCell(totals.totalDrr);
    case "marginRub":
      return moneyCell(totals.totalMarginRub);
    case "marginPercent":
      return (
        <div key={key} className="wb-pg-total wb-pg-total--num">
          {totals.totalMarginPercent !== null ? formatPercent(totals.totalMarginPercent) : "—"}
        </div>
      );
    case "ordersSum":
      return moneyCell(totals.totalOrdersSum);
    case "revenue":
      return moneyCell(totals.totalRevenue);
    case "costSum":
      return moneyCell(totals.totalCostSum);
    case "adSpend":
      return moneyCell(totals.totalAdSpend);
    case "drrPercent":
      return (
        <div key={key} className="wb-pg-total wb-pg-total--num">
          {totals.totalDrrPercent !== null ? formatPercent(totals.totalDrrPercent) : "—"}
        </div>
      );
    default:
      return <div key={key} className="wb-pg-total" />;
  }
}
