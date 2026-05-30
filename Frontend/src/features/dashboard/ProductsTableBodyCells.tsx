import type { CSSProperties, ReactElement } from "react";

import type { CostPriceCurrent } from "../../api/syncClientCostPrice";
import type { TodayBuyoutCount } from "../../api/syncClientBuyouts";
import type { TodayOrderCount } from "../../api/syncClientOrders";
import type { PriceChangeStatus } from "../../api/syncClientPrices";
import { formatMoney, formatPercent } from "../../formatters";
import { CalcInputCell, CostInputCell, PriceInputCell } from "./ProductsTableCells";
import type { EditableColumnKey, EditingCell } from "./useProductsTableSelection";
import type { CurrentPriceEntry } from "./useCurrentPrices";
import type { ProductColumnDefinition, ProductsColumnKey } from "./productsTableColumns";
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
  /** Фактический ДРР % на товар (расход / выручка) — только «Товары». Считается на бэке. */
  drrPercentValues: Map<number, number>;
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
    colKey: ProductsColumnKey,
    event: React.MouseEvent,
  ) => void;
  onCellMouseEnter: (nmId: number, rowIndex: number, colKey: ProductsColumnKey) => void;
  onCellDoubleClick: (nmId: number, colKey: ProductsColumnKey) => void;
  onCostSaved: (nmId: number, value: number) => Promise<void>;
  onCommitEdit: () => void;
  onStartEditCost: (nmId: number) => void;
  /** Вход в правку поля-ввода калькулятора (целевая маржа / цена) по карандашу. */
  onStartEditCalc: (nmId: number, colKey: EditableColumnKey) => void;
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
  // Выделение ячеек и его подсветка навешиваются обобщённо на уровне клонирования
  // (ProductsGridRows), здесь — только режим правки редактируемых ячеек.
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
      const editingThis = isCellEditing("cost");
      return (
        <div key={key} className="wb-pg-cell wb-pg-cell--num wb-pg-cell--cost">
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
      const editingThis = isCellEditing("targetMargin");
      return (
        <div key={key} className="wb-pg-cell wb-pg-cell--num wb-pg-cell--cost">
          {nmId !== null ? (
            <CalcInputCell
              nmId={nmId}
              colKey="targetMargin"
              savedValue={ctx.targetMarginInputs.get(nmId) ?? null}
              isEditing={editingThis}
              initialChar={editingThis ? ctx.initialEditChar : null}
              onChange={ctx.onTargetMarginChange}
              onCommitEdit={ctx.onCommitEdit}
              onStartEdit={ctx.onStartEditCalc}
              format={formatPercent}
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
      return <div key={key} className="wb-pg-cell wb-pg-cell--num">{formatMoney(r)}</div>;
    }
    case "priceInput": {
      const editingThis = isCellEditing("priceInput");
      return (
        <div key={key} className="wb-pg-cell wb-pg-cell--num wb-pg-cell--cost">
          {nmId !== null ? (
            <CalcInputCell
              nmId={nmId}
              colKey="priceInput"
              savedValue={ctx.priceCalcInputs.get(nmId) ?? null}
              isEditing={editingThis}
              initialChar={editingThis ? ctx.initialEditChar : null}
              onChange={ctx.onPriceCalcChange}
              onCommitEdit={ctx.onCommitEdit}
              onStartEdit={ctx.onStartEditCalc}
              format={formatMoney}
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
      return <div key={key} className="wb-pg-cell wb-pg-cell--num">{formatPercent(r)}</div>;
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
    case "drrPercent": {
      // ДРР приходит с бэка только при наличии расхода и выручки (>0) → есть значение = показываем.
      const drr = nmId !== null ? ctx.drrPercentValues.get(nmId) : undefined;
      return (
        <div key={key} className="wb-pg-cell wb-pg-cell--num">
          {drr !== undefined ? formatPercent(drr) : dash}
        </div>
      );
    }
  }
}

/** Источники значений для копирования ячеек в буфер (TSV) — подмножество данных ctx. */
export type ProductCellCopyCtx = Pick<
  ProductsBodyRenderCtx,
  | "costPrices"
  | "priceCounts"
  | "priceChangeStatuses"
  | "commissionValues"
  | "taxValues"
  | "acquiringValues"
  | "acquiringPercentValues"
  | "drrValues"
  | "marginRubValues"
  | "marginPercentValues"
  | "targetMarginInputs"
  | "priceCalcInputs"
  | "priceForMarginValues"
  | "marginForPriceValues"
  | "orderCounts"
  | "rollingBuyoutCounts"
  | "sppValues"
  | "stockCounts"
  | "ordersSumValues"
  | "revenueValues"
  | "costSumValues"
  | "adSpendValues"
  | "drrPercentValues"
>;

const money2 = (v: number | null | undefined): string =>
  v === null || v === undefined ? "" : v.toFixed(2);

/**
 * Значение ячейки «как есть» для буфера обмена (Ctrl/Cmd+C → TSV в Excel/Sheets):
 * деньги/проценты — числом без ₽/% и без пробелов в тысячах (2 знака), целые — String,
 * текст — как в ячейке. Отдельно от display-рендера (там форматирование для UI).
 */
export function productCellCopyValue(
  colKey: ProductsColumnKey,
  product: ProductListItem,
  rowIndex: number,
  ctx: ProductCellCopyCtx,
): string {
  const nmId = product.nmId;
  if (nmId === null) {
    if (colKey === "index") return String(rowIndex + 1);
    if (colKey === "vendorCode") return getDisplayVendorCode(product);
    if (colKey === "category") return product.categoryName ?? "";
    if (colKey === "subject") return product.subjectName ?? "";
    return "";
  }
  switch (colKey) {
    case "index":
      return String(rowIndex + 1);
    case "nmId":
      return String(nmId);
    case "vendorCode":
      return getDisplayVendorCode(product);
    case "category":
      return product.categoryName ?? "";
    case "subject":
      return product.subjectName ?? "";
    case "cost":
      return money2(ctx.costPrices.get(nmId)?.costValue ?? null);
    case "price": {
      const overlay = ctx.priceChangeStatuses.get(nmId);
      return money2(overlay ? overlay.desiredFinal : ctx.priceCounts.get(nmId)?.priceWithDiscount ?? null);
    }
    case "commission":
      return money2(ctx.commissionValues.get(nmId));
    case "tax":
      return money2(ctx.taxValues.get(nmId));
    case "acquiring":
      return money2(ctx.acquiringValues.get(nmId));
    case "acquiringPercent":
      return money2(ctx.acquiringPercentValues.get(nmId));
    case "drr":
      return money2(ctx.drrValues.get(nmId));
    case "marginRub":
      return money2(ctx.marginRubValues.get(nmId));
    case "marginPercent":
      return money2(ctx.marginPercentValues.get(nmId));
    case "targetMargin": {
      const v = ctx.targetMarginInputs.get(nmId);
      return v === undefined ? "" : String(v);
    }
    case "priceForMargin":
      return money2(ctx.priceForMarginValues.get(nmId) ?? null);
    case "priceInput": {
      const v = ctx.priceCalcInputs.get(nmId);
      return v === undefined ? "" : String(v);
    }
    case "marginForPrice":
      return money2(ctx.marginForPriceValues.get(nmId) ?? null);
    case "orders": {
      const o = ctx.orderCounts.get(nmId);
      return o && o.ordersCount > 0 ? String(o.ordersCount) : "";
    }
    case "buyout": {
      const b = ctx.rollingBuyoutCounts.get(nmId);
      return b && b.ordersCount > 0 && b.buyoutsCount > 0
        ? ((b.buyoutsCount / b.ordersCount) * 100).toFixed(2)
        : "";
    }
    case "spp": {
      const v = ctx.sppValues.get(nmId);
      return v === undefined ? "" : v.toFixed(2);
    }
    case "stock": {
      const v = ctx.stockCounts.get(nmId);
      return v === undefined ? "" : String(v);
    }
    case "ordersSum":
      return money2(ctx.ordersSumValues.get(nmId));
    case "revenue":
      return money2(ctx.revenueValues.get(nmId));
    case "costSum":
      return money2(ctx.costSumValues.get(nmId));
    case "adSpend":
      return money2(ctx.adSpendValues.get(nmId));
    case "drrPercent":
      return money2(ctx.drrPercentValues.get(nmId));
  }
}
