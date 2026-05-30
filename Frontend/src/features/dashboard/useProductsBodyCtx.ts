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
  | "onCostSaved"
>;

/**
 * Состояние выделения/редактирования + хендлеры (имена как у useProductsTableSelection,
 * чтобы её возвращаемое значение передавалось сюда без переименований).
 */
export type ProductsBodySelection = {
  selectedNmIds: Set<number>;
  editingNmId: number | null;
  editingPriceNmId: number | null;
  handleCellClick: ProductsBodyRenderCtx["onCellClick"];
  handleCellDoubleClick: ProductsBodyRenderCtx["onCellDoubleClick"];
  handleCommitEdit: ProductsBodyRenderCtx["onCommitEdit"];
  handleStartEdit: ProductsBodyRenderCtx["onStartEdit"];
  handleStartPriceEdit: ProductsBodyRenderCtx["onStartPriceEdit"];
  handleCommitPriceEdit: ProductsBodyRenderCtx["onCommitPriceEdit"];
  handleRequestPriceConfirm: ProductsBodyRenderCtx["onRequestPriceConfirm"];
};

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
      sppValues: data.sppValues,
      commissionValues: data.commissionValues,
      taxValues: data.taxValues,
      acquiringValues: data.acquiringValues,
      acquiringPercentValues: data.acquiringPercentValues,
      acquiringFactualSet: data.acquiringFactualSet,
      drrValues: data.drrValues,
      marginRubValues: data.marginRubValues,
      marginPercentValues: data.marginPercentValues,
      priceChangeStatuses: data.priceChangeStatuses,
      onCostSaved: data.onCostSaved,
      selectedNmIds: selection.selectedNmIds,
      editingNmId: selection.editingNmId,
      editingPriceNmId: selection.editingPriceNmId,
      onCellClick: selection.handleCellClick,
      onCellDoubleClick: selection.handleCellDoubleClick,
      onCommitEdit: selection.handleCommitEdit,
      onStartEdit: selection.handleStartEdit,
      onStartPriceEdit: selection.handleStartPriceEdit,
      onCommitPriceEdit: selection.handleCommitPriceEdit,
      onRequestPriceConfirm: selection.handleRequestPriceConfirm,
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
      data.sppValues,
      data.commissionValues,
      data.taxValues,
      data.acquiringValues,
      data.acquiringPercentValues,
      data.acquiringFactualSet,
      data.drrValues,
      data.marginRubValues,
      data.marginPercentValues,
      data.priceChangeStatuses,
      data.onCostSaved,
      selection.selectedNmIds,
      selection.editingNmId,
      selection.editingPriceNmId,
      selection.handleCellClick,
      selection.handleCellDoubleClick,
      selection.handleCommitEdit,
      selection.handleStartEdit,
      selection.handleStartPriceEdit,
      selection.handleCommitPriceEdit,
      selection.handleRequestPriceConfirm,
    ],
  );
}
