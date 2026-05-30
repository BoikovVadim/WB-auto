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
  acquiringPercentValues: Map<number, number>;
  acquiringFactualSet: Set<number>;
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

// Ячейка grid-таблицы: <div> с className/style (grid дорисовывает абсолютное
// позиционирование клоном — см. ProductsTableGrid).
export type GridCell = ReactElement<{ className?: string; style?: CSSProperties }>;

/** Числовая ₽-ячейка: formatMoney при наличии значения, иначе тусклый «—». */
function moneyCell(key: string, value: number | undefined, positiveOnly: boolean): GridCell {
  const show = value !== undefined && (!positiveOnly || value > 0);
  return (
    <div key={key} className="wb-pg-cell wb-pg-cell--num">
      {show ? formatMoney(value) : dash}
    </div>
  );
}

/** Ячейка тела таблицы товаров для одной колонки. */
export function renderProductsBodyCell(
  col: ProductColumnDefinition,
  product: ProductListItem,
  index: number,
  ctx: ProductsBodyRenderCtx,
): GridCell | undefined {
  const key = col.key;
  const nmId = product.nmId;
  const isSelected = nmId !== null && ctx.selectedNmIds.has(nmId);
  const isEditing = nmId !== null && ctx.editingNmId === nmId;

  switch (key) {
    case "index":
      return <div key={key} className="wb-pg-cell wb-pg-cell--num">{String(index + 1)}</div>;
    case "nmId":
      return <div key={key} className="wb-pg-cell wb-pg-cell--num">{nmId === null ? "—" : String(nmId)}</div>;
    case "vendorCode":
      return (
        <div key={key} className="wb-pg-cell">
          <span className="wb-pg-ellipsis" title={getDisplayVendorCode(product)}>
            {getDisplayVendorCode(product)}
          </span>
        </div>
      );
    case "category":
      return (
        <div key={key} className="wb-pg-cell">
          <span className="wb-pg-ellipsis">{product.categoryName ?? "—"}</span>
        </div>
      );
    case "subject":
      return (
        <div key={key} className="wb-pg-cell">
          <span className="wb-pg-ellipsis">{product.subjectName ?? "—"}</span>
        </div>
      );
    case "cost":
      return (
        <div
          key={key}
          className={`wb-pg-cell wb-pg-cell--num wb-pg-cell--cost${isSelected ? " wb-pg-cell--cost-selected" : ""}`}
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
        </div>
      );
    case "price":
      return (
        <div key={key} className="wb-pg-cell wb-pg-cell--num wb-pg-cell--cost">
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
        </div>
      );
    case "commission":
      return moneyCell(key, nmId !== null ? ctx.commissionValues.get(nmId) : undefined, false);
    case "tax":
      return moneyCell(key, nmId !== null ? ctx.taxValues.get(nmId) : undefined, false);
    case "acquiring":
      return moneyCell(key, nmId !== null ? ctx.acquiringValues.get(nmId) : undefined, false);
    case "acquiringPercent": {
      // % эквайринга: факт за последнюю закрытую неделю или подставленный ручной %.
      // Fallback (продаж за неделю не было) рисуем приглушённо + подсказка, чтобы факт
      // и ручную подстановку было видно глазом.
      const pct = nmId !== null ? ctx.acquiringPercentValues.get(nmId) : undefined;
      if (pct === undefined) {
        return <div key={key} className="wb-pg-cell wb-pg-cell--num">{dash}</div>;
      }
      const isFactual = nmId !== null && ctx.acquiringFactualSet.has(nmId);
      return (
        <div
          key={key}
          className="wb-pg-cell wb-pg-cell--num"
          title={isFactual ? "Факт за последнюю закрытую неделю" : "Ручной % — продаж за неделю не было"}
          style={isFactual ? undefined : { opacity: 0.5 }}
        >
          {formatPercent(pct)}
        </div>
      );
    }
    case "drr":
      return moneyCell(key, nmId !== null ? ctx.drrValues.get(nmId) : undefined, false);
    case "marginRub":
      // Маржа бывает отрицательной/нулевой — показываем как есть (positiveOnly=false), «—» только без данных.
      return moneyCell(key, nmId !== null ? ctx.marginRubValues.get(nmId) : undefined, false);
    case "marginPercent": {
      const margin = nmId !== null ? ctx.marginPercentValues.get(nmId) : undefined;
      return (
        <div key={key} className="wb-pg-cell wb-pg-cell--num">
          {margin !== undefined ? formatPercent(margin) : dash}
        </div>
      );
    }
    case "orders": {
      const orders = nmId !== null ? ctx.orderCounts.get(nmId) : undefined;
      return (
        <div key={key} className="wb-pg-cell wb-pg-cell--num">
          {orders && orders.ordersCount > 0 ? String(orders.ordersCount) : "—"}
        </div>
      );
    }
    case "buyout": {
      // 0 выкупов при наличии заказов = данных ещё нет → «—» (не фантомные 0,00 %).
      const buyout = nmId !== null ? ctx.rollingBuyoutCounts.get(nmId) : undefined;
      const hasData = !!buyout && buyout.ordersCount > 0 && buyout.buyoutsCount > 0;
      const percent = hasData ? (buyout.buyoutsCount / buyout.ordersCount) * 100 : null;
      return (
        <div key={key} className="wb-pg-cell wb-pg-cell--num">
          {percent !== null ? formatPercent(percent) : dash}
        </div>
      );
    }
    case "spp": {
      // spp=0 — валидное значение (нет скидки); «—» только при отсутствии данных.
      const spp = nmId !== null ? ctx.sppValues.get(nmId) : undefined;
      return (
        <div key={key} className="wb-pg-cell wb-pg-cell--num">
          {spp !== undefined ? formatPercent(spp) : dash}
        </div>
      );
    }
    case "stock": {
      const stock = nmId !== null ? ctx.stockCounts.get(nmId) : undefined;
      return <div key={key} className="wb-pg-cell wb-pg-cell--num">{stock !== undefined ? String(stock) : "—"}</div>;
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
