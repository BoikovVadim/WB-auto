import type { CSSProperties, ReactElement } from "react";

import type { CostPriceCurrent } from "../../api/syncClientCostPrice";
import type { TodayBuyoutCount } from "../../api/syncClientBuyouts";
import type { TodayOrderCount } from "../../api/syncClientOrders";
import type { PriceChangeStatus } from "../../api/syncClientPrices";
import { formatMoney, formatPercent } from "../../formatters";
import { CostInputCell, PriceInputCell } from "./ProductsTableCells";
import type { CurrentPriceEntry } from "./useCurrentPrices";
import type { ProductColumnDefinition } from "./productsTableColumns";
import { getDisplayVendorCode } from "./productsTableHelpers";
import type { ProductListItem } from "./useDashboardProductsWorkspace";

export type ProductsBodyRenderCtx = {
  costPrices: Map<number, CostPriceCurrent>;
  orderCounts: Map<number, TodayOrderCount>;
  rollingBuyoutCounts: Map<number, TodayBuyoutCount>;
  stockCounts: Map<number, number>;
  priceCounts: Map<number, CurrentPriceEntry>;
  ordersSumValues: Map<number, number>;
  revenueValues: Map<number, number>;
  costSumValues: Map<number, number>;
  adSpendValues: Map<number, number>;
  sppValues: Map<number, number>;
  commissionValues: Map<number, number>;
  taxValues: Map<number, number>;
  acquiringValues: Map<number, number>;
  drrValues: Map<number, number>;
  marginRubValues: Map<number, number>;
  marginPercentValues: Map<number, number>;
  priceChangeStatuses: Map<number, PriceChangeStatus>;
  selectedNmIds: Set<number>;
  editingNmId: number | null;
  editingPriceNmId: number | null;
  onCellClick: (nmId: number, index: number, event: React.MouseEvent) => void;
  onCellDoubleClick: (nmId: number, index: number) => void;
  onCostSaved: (nmId: number, value: number) => Promise<void>;
  onCommitEdit: () => void;
  onStartEdit: (nmId: number) => void;
  onStartPriceEdit: (nmId: number) => void;
  onCommitPriceEdit: () => void;
  onRequestPriceConfirm: (nmId: number, target: number) => void;
};

const dash = <span style={{ opacity: 0.3 }}>—</span>;

// Ячейка, которую оборачивает withPin (ему нужны className/style в props).
type PinnableCell = ReactElement<{ className?: string; style?: CSSProperties }>;

/** Числовая ₽-ячейка: formatMoney при наличии значения, иначе тусклый «—». */
function moneyCell(key: string, value: number | undefined, positiveOnly: boolean): PinnableCell {
  const show = value !== undefined && (!positiveOnly || value > 0);
  return (
    <td key={key} className="wb-table-cell--numeric">
      {show ? formatMoney(value) : dash}
    </td>
  );
}

/** Ячейка тела таблицы товаров для одной колонки. */
export function renderProductsBodyCell(
  col: ProductColumnDefinition,
  product: ProductListItem,
  index: number,
  ctx: ProductsBodyRenderCtx,
): PinnableCell | undefined {
  const key = col.key;
  const nmId = product.nmId;
  const isSelected = nmId !== null && ctx.selectedNmIds.has(nmId);
  const isEditing = nmId !== null && ctx.editingNmId === nmId;

  switch (key) {
    case "index":
      return <td key={key} className="wb-table-cell--numeric">{String(index + 1)}</td>;
    case "nmId":
      return <td key={key} className="wb-table-cell--numeric">{nmId === null ? "—" : String(nmId)}</td>;
    case "vendorCode":
      return (
        <td key={key}>
          <span
            title={getDisplayVendorCode(product)}
            style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {getDisplayVendorCode(product)}
          </span>
        </td>
      );
    case "category":
      return <td key={key}>{product.categoryName ?? "—"}</td>;
    case "subject":
      return <td key={key}>{product.subjectName ?? "—"}</td>;
    case "cost":
      return (
        <td
          key={key}
          className={`wb-table-cell--cost${isSelected ? " wb-table-cell--cost-selected" : ""}`}
          onClick={nmId !== null ? (e) => ctx.onCellClick(nmId, index, e) : undefined}
          onDoubleClick={nmId !== null ? () => ctx.onCellDoubleClick(nmId, index) : undefined}
        >
          {nmId !== null ? (
            <CostInputCell
              nmId={nmId}
              savedValue={ctx.costPrices.get(nmId)?.costValue ?? null}
              isSelected={isSelected}
              isEditing={isEditing}
              onSaved={ctx.onCostSaved}
              onCommitEdit={ctx.onCommitEdit}
              onStartEdit={ctx.onStartEdit}
            />
          ) : "—"}
        </td>
      );
    case "price":
      return (
        <td key={key} className="wb-table-cell--numeric wb-table-cell--cost">
          {nmId !== null ? (
            <PriceInputCell
              nmId={nmId}
              entry={ctx.priceCounts.get(nmId)}
              overlay={ctx.priceChangeStatuses.get(nmId)}
              isEditing={ctx.editingPriceNmId === nmId}
              onStartEdit={ctx.onStartPriceEdit}
              onCommitEdit={ctx.onCommitPriceEdit}
              onRequestConfirm={ctx.onRequestPriceConfirm}
            />
          ) : dash}
        </td>
      );
    case "commission":
      return moneyCell(key, nmId !== null ? ctx.commissionValues.get(nmId) : undefined, false);
    case "tax":
      return moneyCell(key, nmId !== null ? ctx.taxValues.get(nmId) : undefined, false);
    case "acquiring":
      return moneyCell(key, nmId !== null ? ctx.acquiringValues.get(nmId) : undefined, false);
    case "drr":
      return moneyCell(key, nmId !== null ? ctx.drrValues.get(nmId) : undefined, false);
    case "marginRub":
      // Маржа бывает отрицательной/нулевой — показываем как есть (positiveOnly=false), «—» только без данных.
      return moneyCell(key, nmId !== null ? ctx.marginRubValues.get(nmId) : undefined, false);
    case "marginPercent": {
      const margin = nmId !== null ? ctx.marginPercentValues.get(nmId) : undefined;
      return (
        <td key={key} className="wb-table-cell--numeric">
          {margin !== undefined ? formatPercent(margin) : dash}
        </td>
      );
    }
    case "orders": {
      const orders = nmId !== null ? ctx.orderCounts.get(nmId) : undefined;
      return (
        <td key={key} className="wb-table-cell--numeric wb-table-cell--orders">
          {orders && orders.ordersCount > 0 ? String(orders.ordersCount) : "—"}
        </td>
      );
    }
    case "buyout": {
      // 0 выкупов при наличии заказов = данных ещё нет → «—» (не фантомные 0,00 %).
      const buyout = nmId !== null ? ctx.rollingBuyoutCounts.get(nmId) : undefined;
      const hasData = !!buyout && buyout.ordersCount > 0 && buyout.buyoutsCount > 0;
      const percent = hasData ? (buyout.buyoutsCount / buyout.ordersCount) * 100 : null;
      return (
        <td key={key} className="wb-table-cell--numeric">
          {percent !== null ? formatPercent(percent) : dash}
        </td>
      );
    }
    case "spp": {
      // spp=0 — валидное значение (нет скидки); «—» только при отсутствии данных.
      const spp = nmId !== null ? ctx.sppValues.get(nmId) : undefined;
      return (
        <td key={key} className="wb-table-cell--numeric">
          {spp !== undefined ? formatPercent(spp) : dash}
        </td>
      );
    }
    case "stock": {
      const stock = nmId !== null ? ctx.stockCounts.get(nmId) : undefined;
      return <td key={key} className="wb-table-cell--numeric">{stock !== undefined ? String(stock) : "—"}</td>;
    }
    case "ordersSum":
      return moneyCell(key, nmId !== null ? ctx.ordersSumValues.get(nmId) : undefined, true);
    case "revenue":
      return moneyCell(key, nmId !== null ? ctx.revenueValues.get(nmId) : undefined, true);
    case "costSum":
      return moneyCell(key, nmId !== null ? ctx.costSumValues.get(nmId) : undefined, true);
    case "adSpend":
      return moneyCell(key, nmId !== null ? ctx.adSpendValues.get(nmId) : undefined, true);
  }
}
