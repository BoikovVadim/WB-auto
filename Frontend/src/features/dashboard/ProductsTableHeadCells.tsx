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
  onDrop: (event: React.DragEvent<HTMLTableCellElement>, key: ProductsColumnKey) => void;
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
    acquiring: () => void;
  };
};

// Ячейка, которую оборачивает withPin (ему нужны className/style в props).
type PinnableCell = ReactElement<{ className?: string; style?: CSSProperties }>;

const NUMERIC_HEADER_KEYS: ReadonlySet<ProductsColumnKey> = new Set([
  "index", "nmId", "cost", "price", "commission", "tax", "acquiring", "acquiringPercent", "drr",
  "marginRub", "marginPercent",
  "orders", "buyout", "spp", "stock", "ordersSum", "revenue", "costSum", "adSpend",
]);

/**
 * Заголовок столбца таблицы товаров. Левые (index/nmId/vendorCode/category/subject) —
 * parent-сортировка; метрики с ретроспективой — клик по названию открывает лист, по
 * стрелке сортирует; read-only метрики (комиссия/эквайринг/ДРР) — только сортировка.
 */
export function renderProductsHeaderCell(
  col: ProductColumnDefinition,
  colIdx: number,
  ctx: ProductsHeaderRenderCtx,
): PinnableCell {
  const key = col.key;
  const parentSortKey = getParentSortKey(key);
  const isParentActive =
    ctx.localSortKey === null && parentSortKey !== null && ctx.parentSortKey === parentSortKey;
  const isLocalActive = ctx.localSortKey === key;
  const isDragging = ctx.draggedColumn === key;

  const dragHandlers = {
    draggable: true as const,
    onDragStart: (e: React.DragEvent<HTMLTableCellElement>) => {
      if ((e.target as HTMLElement).closest(".wb-col-resize-handle")) {
        e.preventDefault();
        return;
      }
      ctx.onDragStart(key);
    },
    onDragEnd: () => ctx.onDragEnd(),
    onDragOver: (e: React.DragEvent<HTMLTableCellElement>) => e.preventDefault(),
    onDrop: (e: React.DragEvent<HTMLTableCellElement>) => ctx.onDrop(e, key),
  };

  const thStyle: React.CSSProperties = {};
  if (NUMERIC_HEADER_KEYS.has(key)) thStyle.textAlign = "right";

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

  const renderParentHeader = (parentKey: ProductListSortKey, withResize: boolean) => (
    <>
      <button className="wb-products-sort-button" type="button" onClick={() => ctx.onParentSort(parentKey)}>
        <span>{getColLabel(key)}</span>
        <SortArrow active={isParentActive} direction={ctx.parentSortDir} />
      </button>
      {withResize && (
        <div className="wb-col-resize-handle" data-col-idx={String(colIdx)} onMouseDown={ctx.onResizeMouseDown} />
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
        return renderSortOnlyHeader("Маржа, ₽", "marginRub");
      case "marginPercent":
        return renderSortOnlyHeader("Маржа, %", "marginPercent");
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
    }
  })();

  return (
    <th
      key={key}
      className={isDragging ? "wb-products-column--dragging" : undefined}
      style={thStyle}
      {...dragHandlers}
    >
      {content}
    </th>
  );
}

/** Ячейка строки «Итого» (вторая строка шапки). Значения берутся из totals. */
export function renderProductsTotalsCell(
  col: ProductColumnDefinition,
  totals: ProductsTableTotals,
): PinnableCell {
  const key = col.key;
  const moneyCell = (value: number | null) => (
    <th key={key} className="wb-table-cell--numeric">
      {value !== null ? formatMoney(value) : "—"}
    </th>
  );

  switch (key) {
    case "vendorCode":
      return (
        <th key={key} style={{ textAlign: "left", fontWeight: 700, color: "rgba(15,23,42,0.45)" }}>
          Итого
        </th>
      );
    case "orders":
      return (
        <th key={key} className="wb-table-cell--numeric">
          {totals.totalOrders > 0 ? String(totals.totalOrders) : "—"}
        </th>
      );
    case "buyout":
      return <th key={key} className="wb-table-cell--numeric">{formatPercent(totals.totalBuyoutPercent)}</th>;
    case "spp":
      return <th key={key} className="wb-table-cell--numeric">{formatPercent(totals.totalSpp)}</th>;
    case "stock":
      return (
        <th key={key} className="wb-table-cell--numeric">
          {totals.totalStocks !== null ? String(totals.totalStocks) : "—"}
        </th>
      );
    case "commission":
      return moneyCell(totals.totalCommission);
    case "tax":
      return moneyCell(totals.totalTax);
    case "acquiring":
      return moneyCell(totals.totalAcquiring);
    case "acquiringPercent":
      return (
        <th key={key} className="wb-table-cell--numeric">
          {totals.totalAcquiringPercent !== null ? formatPercent(totals.totalAcquiringPercent) : "—"}
        </th>
      );
    case "drr":
      return moneyCell(totals.totalDrr);
    case "marginRub":
      return moneyCell(totals.totalMarginRub);
    case "marginPercent":
      return (
        <th key={key} className="wb-table-cell--numeric">
          {totals.totalMarginPercent !== null ? formatPercent(totals.totalMarginPercent) : "—"}
        </th>
      );
    case "ordersSum":
      return moneyCell(totals.totalOrdersSum);
    case "revenue":
      return moneyCell(totals.totalRevenue);
    case "costSum":
      return moneyCell(totals.totalCostSum);
    case "adSpend":
      return moneyCell(totals.totalAdSpend);
    default:
      return <th key={key} />;
  }
}
