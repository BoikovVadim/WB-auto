import { useMemo } from "react";

import type { ProductsBodyRenderCtx } from "./ProductsTableBodyCells";

/** Данные-источники для ячеек: карты значений по nmId + запись себестоимости. */
export type ProductsBodyData = Pick<
  ProductsBodyRenderCtx,
  | "costPrices"
  | "orderCounts"
  | "rollingBuyoutCounts"
  | "stockCounts"
  | "priceCounts"
  | "ordersSumValues"
  | "revenueValues"
  | "costSumValues"
  | "adSpendValues"
  | "drrPercentValues"
  | "sppValues"
  | "commissionValues"
  | "taxValues"
  | "acquiringValues"
  | "acquiringPercentValues"
  | "acquiringFactualSet"
  | "drrValues"
  | "marginRubValues"
  | "marginPercentValues"
  | "priceChangeStatuses"
  | "editable"
  | "onCostSaved"
>;

/** Калькуляторы маржи/цены («Юнит Экономика»): вводы + расчёт обратной величины (бэк). */
export type ProductsCalcCtx = Pick<
  ProductsBodyRenderCtx,
  | "targetMarginInputs"
  | "priceCalcInputs"
  | "priceForMarginValues"
  | "marginForPriceValues"
  | "onTargetMarginChange"
  | "onPriceCalcChange"
>;

/**
 * Состояние выделения ячеек/редактирования + хендлеры. Имена совпадают с возвращаемым
 * значением useProductsTableSelection — передаётся сюда без переименований.
 */
export type ProductsBodySelection = Pick<
  ProductsBodyRenderCtx,
  | "selectedCells"
  | "editing"
  | "editingPriceNmId"
  | "initialEditChar"
  | "onCellMouseDown"
  | "onCellMouseEnter"
  | "onCellDoubleClick"
  | "onCommitEdit"
  | "onStartEditCost"
  | "onStartEditCalc"
  | "onStartPriceEdit"
  | "onCommitPriceEdit"
  | "onRequestPriceConfirm"
>;

/**
 * Собирает СТАБИЛЬНЫЙ (memo) контекст рендера ячеек тела таблицы товаров/юнит-экономики.
 *
 * Стабильность ссылки критична: строка рендерится через ProductsTableRow (React.memo),
 * и при вертикальном скролле bodyCtx не должен менять ссылку — иначе все видимые строки
 * переотрисуются на каждый кадр и начнут «пропадать»/появляться с задержкой. Ссылка
 * меняется только когда реально пришли новые данные или сменилось выделение/редактирование.
 */
export function useProductsBodyCtx(
  data: ProductsBodyData,
  selection: ProductsBodySelection,
  calc: ProductsCalcCtx,
): ProductsBodyRenderCtx {
  return useMemo(
    () => ({
      costPrices: data.costPrices,
      orderCounts: data.orderCounts,
      rollingBuyoutCounts: data.rollingBuyoutCounts,
      stockCounts: data.stockCounts,
      priceCounts: data.priceCounts,
      ordersSumValues: data.ordersSumValues,
      revenueValues: data.revenueValues,
      costSumValues: data.costSumValues,
      adSpendValues: data.adSpendValues,
      drrPercentValues: data.drrPercentValues,
      sppValues: data.sppValues,
      commissionValues: data.commissionValues,
      taxValues: data.taxValues,
      acquiringValues: data.acquiringValues,
      acquiringPercentValues: data.acquiringPercentValues,
      acquiringFactualSet: data.acquiringFactualSet,
      drrValues: data.drrValues,
      marginRubValues: data.marginRubValues,
      marginPercentValues: data.marginPercentValues,
      targetMarginInputs: calc.targetMarginInputs,
      priceCalcInputs: calc.priceCalcInputs,
      priceForMarginValues: calc.priceForMarginValues,
      marginForPriceValues: calc.marginForPriceValues,
      onTargetMarginChange: calc.onTargetMarginChange,
      onPriceCalcChange: calc.onPriceCalcChange,
      priceChangeStatuses: data.priceChangeStatuses,
      editable: data.editable,
      onCostSaved: data.onCostSaved,
      selectedCells: selection.selectedCells,
      editing: selection.editing,
      editingPriceNmId: selection.editingPriceNmId,
      initialEditChar: selection.initialEditChar,
      onCellMouseDown: selection.onCellMouseDown,
      onCellMouseEnter: selection.onCellMouseEnter,
      onCellDoubleClick: selection.onCellDoubleClick,
      onCommitEdit: selection.onCommitEdit,
      onStartEditCost: selection.onStartEditCost,
      onStartEditCalc: selection.onStartEditCalc,
      onStartPriceEdit: selection.onStartPriceEdit,
      onCommitPriceEdit: selection.onCommitPriceEdit,
      onRequestPriceConfirm: selection.onRequestPriceConfirm,
    }),
    [
      data.costPrices,
      data.orderCounts,
      data.rollingBuyoutCounts,
      data.stockCounts,
      data.priceCounts,
      data.ordersSumValues,
      data.revenueValues,
      data.costSumValues,
      data.adSpendValues,
      data.drrPercentValues,
      data.sppValues,
      data.commissionValues,
      data.taxValues,
      data.acquiringValues,
      data.acquiringPercentValues,
      data.acquiringFactualSet,
      data.drrValues,
      data.marginRubValues,
      data.marginPercentValues,
      calc.targetMarginInputs,
      calc.priceCalcInputs,
      calc.priceForMarginValues,
      calc.marginForPriceValues,
      calc.onTargetMarginChange,
      calc.onPriceCalcChange,
      data.priceChangeStatuses,
      data.editable,
      data.onCostSaved,
      selection.selectedCells,
      selection.editing,
      selection.editingPriceNmId,
      selection.initialEditChar,
      selection.onCellMouseDown,
      selection.onCellMouseEnter,
      selection.onCellDoubleClick,
      selection.onCommitEdit,
      selection.onStartEditCost,
      selection.onStartEditCalc,
      selection.onStartPriceEdit,
      selection.onCommitPriceEdit,
      selection.onRequestPriceConfirm,
    ],
  );
}
