import type { CSSProperties, ReactElement } from "react";

import type { CostPriceCurrent } from "../../api/syncClientCostPrice";
import type { TodayBuyoutCount } from "../../api/syncClientBuyouts";
import type { TodayOrderCount } from "../../api/syncClientOrders";
import type { PriceChangeStatus } from "../../api/syncClientPrices";
import { formatMoney, formatPercent } from "../../formatters";
import { CalcInputCell, CostInputCell, PriceInputCell } from "./ProductsTableCells";
import { cellKey, type EditableColumnKey, type EditingCell } from "./useProductsTableSelection";
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
  /** Калькуляторы (только «Юнит Экономика»): вводы по nmId + расчёт обратной величины (бэк). */
  targetMarginInputs: Map<number, number>;
  priceCalcInputs: Map<number, number>;
  /** Нужная цена под целевую маржу: number — ок, null — недостижима/нет с/с, undefined — считается. */
  priceForMarginValues: Map<number, number | null>;
  /** Итоговая маржа % при введённой цене: number — ок, null — нет с/с/цена ≤ 0, undefined — считается. */
  marginForPriceValues: Map<number, number | null>;
  onTargetMarginChange: (nmId: number, value: number | null) => void;
  onPriceCalcChange: (nmId: number, value: number | null) => void;
  priceChangeStatuses: Map<number, PriceChangeStatus>;
  /** Редактирование себестоимости/цены доступно только в «Юнит Экономика».
   *  В «Товары» (editable=false) cost/price рендерятся read-only — те же значения,
   *  но без карандаша, инлайн-ввода и выделения ячеек под Delete. */
  editable: boolean;
  /** Выделенные ячейки (как в Sheets), ключ `${nmId}|${colKey}` — см. cellKey. */
  selectedCells: Set<string>;
  /** Ячейка в режиме правки (себестоимость/поля калькулятора). */
  editing: EditingCell | null;
  editingPriceNmId: number | null;
  /** Первый набранный символ для правки набором (передаётся только редактируемой ячейке). */
  initialEditChar: string | null;
  onCellMouseDown: (
    nmId: number,
    rowIndex: number,
    colKey: EditableColumnKey,
    event: React.MouseEvent,
  ) => void;
  onCellMouseEnter: (nmId: number, rowIndex: number, colKey: EditableColumnKey) => void;
  onCellDoubleClick: (nmId: number, colKey: EditableColumnKey) => void;
  onCostSaved: (nmId: number, value: number) => Promise<void>;
  onCommitEdit: () => void;
  onStartEditCost: (nmId: number) => void;
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
  const isCellSelected = (colKey: EditableColumnKey): boolean =>
    nmId !== null && ctx.selectedCells.has(cellKey(nmId, colKey));
  const isCellEditing = (colKey: EditableColumnKey): boolean =>
    nmId !== null && ctx.editing?.nmId === nmId && ctx.editing.colKey === colKey;

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
    case "cost": {
      const selected = ctx.editable && isCellSelected("cost");
      const editingThis = isCellEditing("cost");
      return (
        <div
          key={key}
          className={`wb-pg-cell wb-pg-cell--num wb-pg-cell--cost${selected ? " wb-pg-cell--cell-selected" : ""}`}
          onMouseDown={ctx.editable && nmId !== null ? (e) => ctx.onCellMouseDown(nmId, index, "cost", e) : undefined}
          onMouseEnter={ctx.editable && nmId !== null ? () => ctx.onCellMouseEnter(nmId, index, "cost") : undefined}
          onDoubleClick={ctx.editable && nmId !== null ? () => ctx.onCellDoubleClick(nmId, "cost") : undefined}
        >
          {nmId !== null ? (
            <CostInputCell
              nmId={nmId}
              savedValue={ctx.costPrices.get(nmId)?.costValue ?? null}
              isEditing={editingThis}
              editable={ctx.editable}
              initialChar={editingThis ? ctx.initialEditChar : null}
              onSaved={ctx.onCostSaved}
              onCommitEdit={ctx.onCommitEdit}
              onStartEdit={ctx.onStartEditCost}
            />
          ) : "—"}
        </div>
      );
    }
    case "price":
      return (
        <div key={key} className="wb-pg-cell wb-pg-cell--num wb-pg-cell--cost">
          {nmId !== null ? (
            <PriceInputCell
              nmId={nmId}
              entry={ctx.priceCounts.get(nmId)}
              overlay={ctx.priceChangeStatuses.get(nmId)}
              isEditing={ctx.editingPriceNmId === nmId}
              editable={ctx.editable}
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
    case "targetMargin": {
      const selected = isCellSelected("targetMargin");
      const editingThis = isCellEditing("targetMargin");
      return (
        <div
          key={key}
          className={`wb-pg-cell wb-pg-cell--num wb-pg-cell--cost${selected ? " wb-pg-cell--cell-selected" : ""}`}
          onMouseDown={nmId !== null ? (e) => ctx.onCellMouseDown(nmId, index, "targetMargin", e) : undefined}
          onMouseEnter={nmId !== null ? () => ctx.onCellMouseEnter(nmId, index, "targetMargin") : undefined}
          onDoubleClick={nmId !== null ? () => ctx.onCellDoubleClick(nmId, "targetMargin") : undefined}
        >
          {nmId !== null ? (
            <CalcInputCell
              nmId={nmId}
              savedValue={ctx.targetMarginInputs.get(nmId) ?? null}
              isEditing={editingThis}
              initialChar={editingThis ? ctx.initialEditChar : null}
              onChange={ctx.onTargetMarginChange}
              onCommitEdit={ctx.onCommitEdit}
              ariaLabel="Целевая маржа, %"
            />
          ) : dash}
        </div>
      );
    }
    case "priceForMargin": {
      // Расчёт нужной цены: пусто без ввода маржи; «—» если маржа недостижима/нет с/с.
      if (nmId === null || !ctx.targetMarginInputs.has(nmId)) {
        return <div key={key} className="wb-pg-cell wb-pg-cell--num">{dash}</div>;
      }
      const r = ctx.priceForMarginValues.get(nmId);
      if (r === undefined) {
        return <div key={key} className="wb-pg-cell wb-pg-cell--num" style={{ opacity: 0.4 }}>…</div>;
      }
      if (r === null) {
        return (
          <div key={key} className="wb-pg-cell wb-pg-cell--num" style={{ opacity: 0.5 }} title="Маржа недостижима или нет себестоимости">
            —
          </div>
        );
      }
      return <div key={key} className="wb-pg-cell wb-pg-cell--num wb-pg-cell--calc">{formatMoney(r)}</div>;
    }
    case "priceInput": {
      const selected = isCellSelected("priceInput");
      const editingThis = isCellEditing("priceInput");
      return (
        <div
          key={key}
          className={`wb-pg-cell wb-pg-cell--num wb-pg-cell--cost${selected ? " wb-pg-cell--cell-selected" : ""}`}
          onMouseDown={nmId !== null ? (e) => ctx.onCellMouseDown(nmId, index, "priceInput", e) : undefined}
          onMouseEnter={nmId !== null ? () => ctx.onCellMouseEnter(nmId, index, "priceInput") : undefined}
          onDoubleClick={nmId !== null ? () => ctx.onCellDoubleClick(nmId, "priceInput") : undefined}
        >
          {nmId !== null ? (
            <CalcInputCell
              nmId={nmId}
              savedValue={ctx.priceCalcInputs.get(nmId) ?? null}
              isEditing={editingThis}
              initialChar={editingThis ? ctx.initialEditChar : null}
              onChange={ctx.onPriceCalcChange}
              onCommitEdit={ctx.onCommitEdit}
              ariaLabel="Цена для расчёта маржи, ₽"
            />
          ) : dash}
        </div>
      );
    }
    case "marginForPrice": {
      // Расчёт маржи при введённой цене: пусто без ввода цены; «—» если нет с/с.
      if (nmId === null || !ctx.priceCalcInputs.has(nmId)) {
        return <div key={key} className="wb-pg-cell wb-pg-cell--num">{dash}</div>;
      }
      const r = ctx.marginForPriceValues.get(nmId);
      if (r === undefined) {
        return <div key={key} className="wb-pg-cell wb-pg-cell--num" style={{ opacity: 0.4 }}>…</div>;
      }
      if (r === null) {
        return (
          <div key={key} className="wb-pg-cell wb-pg-cell--num" style={{ opacity: 0.5 }} title="Нет себестоимости">
            —
          </div>
        );
      }
      return <div key={key} className="wb-pg-cell wb-pg-cell--num wb-pg-cell--calc">{formatPercent(r)}</div>;
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
