import { ui } from "./copy";
import type { ProductColumnDefinition, ProductsColumnKey } from "./productsTableColumns";
import type { ProductListSortKey } from "./useDashboardProductsWorkspace";

// ─── Column width helper ──────────────────────────────────────────────────────

export function getColWidth(col: ProductColumnDefinition, nameColWidth: number): number {
  return col.key === "vendorCode" ? nameColWidth : col.defaultWidth;
}

// ─── Отображаемое «Название» товара ───────────────────────────────────────────
// vendorCode, иначе #nmId, иначе «—».
export function getDisplayVendorCode(p: { vendorCode: string; nmId: number | null }): string {
  return p.vendorCode !== "" ? p.vendorCode : p.nmId !== null ? `#${String(p.nmId)}` : "—";
}

// ─── Column label ─────────────────────────────────────────────────────────────

export function getColLabel(key: ProductsColumnKey): string {
  switch (key) {
    case "index":     return ui.rowNumber;
    case "nmId":      return ui.productIdColumn;
    case "vendorCode": return ui.productNameColumn;
    case "category":  return ui.category;
    case "subject":   return ui.subject;
    case "cost":      return "Себестоимость";
    case "price":     return "Цена";
    case "commission": return "Комиссия";
    case "acquiring": return "Эквайринг";
    case "drr":       return "ДРР";
    case "orders":    return "Заказы";
    case "buyout":    return "% выкупа";
    case "spp":       return "СПП";
    case "stock":     return "Остатки";
    case "ordersSum": return "Сумма заказов";
    case "revenue":   return "Выручка";
    case "costSum":   return "С/с продаж";
    case "adSpend":   return "Реклама";
  }
}

// ─── Parent sort key mapping ──────────────────────────────────────────────────

export function getParentSortKey(key: ProductsColumnKey): ProductListSortKey | null {
  switch (key) {
    case "index":     return "id";
    case "nmId":      return "id";
    case "vendorCode": return "name";
    case "category":  return "category";
    case "subject":   return "subject";
    default:          return null;
  }
}
