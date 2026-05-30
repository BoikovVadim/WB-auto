import {
  applyStoredRawColumnOrder,
  moveRawColumn,
  readStoredRawColumnOrder,
  writeStoredRawColumnOrder,
} from "./rawTable";

export type ProductsColumnKey =
  | "index"
  | "nmId"
  | "vendorCode"
  | "category"
  | "subject"
  | "cost"
  | "price"
  | "commission"
  | "tax"
  | "acquiring"
  | "acquiringPercent"
  | "drr"
  | "marginRub"
  | "marginPercent"
  | "targetMargin"
  | "priceForMargin"
  | "priceInput"
  | "marginForPrice"
  | "orders"
  | "buyout"
  | "spp"
  | "stock"
  | "ordersSum"
  | "revenue"
  | "costSum"
  | "adSpend";

export type ProductColumnDefinition = {
  key: ProductsColumnKey;
  defaultWidth: number;
};

// v10: добавлены колонки-калькуляторы (после «Маржа, %», только в «Юнит Экономике»):
//      «Целевая маржа, %» (ввод) → «Цена для маржи, ₽» (расчёт) и «Цена, ₽» (ввод) →
//      «Маржа при цене, %» (расчёт). Все вычисления на бэке (POST .../calc).
// v9: добавлена колонка «Эквайринг, %» (после «Эквайринг, ₽», только в «Юнит Экономике»);
//     фактический эквайринг из отчёта реализации, ₽-колонка теперь тоже по факту.
// v8: добавлена колонка «Налог, ₽» (после «Комиссия», только в «Юнит Экономике»).
// v7: добавлены «Маржа, ₽»/«Маржа, %» (после «ДРР», только в «Юнит Экономике»).
// v6: добавлена колонка «ДРР, ₽» (после «Эквайринг», только в «Юнит Экономике»).
// v5: добавлены «Комиссия, ₽»/«Эквайринг, ₽». Бамп сбрасывает сохранённый порядок к
// дефолту, чтобы новые колонки встали на нужное место (не уехали в конец у тех,
// кто уже двигал колонки). Ширины хранятся отдельно и не теряются.
export const PRODUCTS_COLUMN_STORAGE_KEY = "wb-products-column-order-v10";

export const productsTableColumnDefs: ProductColumnDefinition[] = [
  { key: "index",     defaultWidth: 48  },
  { key: "nmId",      defaultWidth: 110 },
  { key: "vendorCode", defaultWidth: 130 },
  { key: "category",  defaultWidth: 160 },
  { key: "subject",   defaultWidth: 120 },
  { key: "cost",      defaultWidth: 140 },
  { key: "price",     defaultWidth: 130 },
  { key: "commission", defaultWidth: 130 },
  { key: "tax",       defaultWidth: 130 },
  { key: "acquiring", defaultWidth: 130 },
  { key: "acquiringPercent", defaultWidth: 120 },
  { key: "drr",       defaultWidth: 130 },
  { key: "marginRub", defaultWidth: 130 },
  { key: "marginPercent", defaultWidth: 110 },
  { key: "targetMargin", defaultWidth: 130 },
  { key: "priceForMargin", defaultWidth: 140 },
  { key: "priceInput", defaultWidth: 130 },
  { key: "marginForPrice", defaultWidth: 140 },
  { key: "orders",    defaultWidth: 110 },
  { key: "buyout",    defaultWidth: 110 },
  { key: "spp",       defaultWidth: 110 },
  { key: "stock",     defaultWidth: 100 },
  { key: "ordersSum", defaultWidth: 130 },
  { key: "revenue",   defaultWidth: 130 },
  { key: "costSum",   defaultWidth: 130 },
  { key: "adSpend",   defaultWidth: 130 },
];

const PRODUCTS_COLUMN_KEYS = productsTableColumnDefs.map((c) => c.key);

// Колонки, скрытые в разделе «Юнит Экономика» (тот же вид товаров, но без
// заказов/остатков/сумм/выручки/с-с продаж/рекламы — туда переносим юнит-экономику).
export const UNIT_ECONOMICS_HIDDEN_COLUMNS: ProductsColumnKey[] = [
  "orders",
  "stock",
  "ordersSum",
  "revenue",
  "costSum",
  "adSpend",
];

// Колонки, специфичные для «Юнит Экономики» (комиссия/эквайринг) — скрыты в обычном
// разделе «Товары». Так одни и те же определения колонок (порядок/ширины общие)
// показываются по-разному в двух секциях.
export const CATALOG_PRODUCTS_HIDDEN_COLUMNS: ProductsColumnKey[] = [
  "commission",
  "tax",
  "acquiring",
  "acquiringPercent",
  "drr",
  "marginRub",
  "marginPercent",
  "targetMargin",
  "priceForMargin",
  "priceInput",
  "marginForPrice",
];

export function readStoredProductsColumnOrder(): ProductsColumnKey[] {
  const stored = readStoredRawColumnOrder(PRODUCTS_COLUMN_STORAGE_KEY, PRODUCTS_COLUMN_KEYS);
  return stored.filter((v): v is ProductsColumnKey =>
    PRODUCTS_COLUMN_KEYS.includes(v as ProductsColumnKey),
  );
}

export function writeStoredProductsColumnOrder(columns: ProductsColumnKey[]): void {
  writeStoredRawColumnOrder(PRODUCTS_COLUMN_STORAGE_KEY, columns);
}

export function applyStoredProductsColumnOrder(
  saved: ProductsColumnKey[],
): ProductColumnDefinition[] {
  const resolved = applyStoredRawColumnOrder(PRODUCTS_COLUMN_KEYS, saved);
  const byKey = new Map(productsTableColumnDefs.map((c) => [c.key, c]));
  return resolved.flatMap((k) => {
    const col = byKey.get(k as ProductsColumnKey);
    return col ? [col] : [];
  });
}

export function moveProductsColumn(
  columns: ProductsColumnKey[],
  source: ProductsColumnKey,
  target: ProductsColumnKey,
): ProductsColumnKey[] {
  return moveRawColumn(columns, source, target) as ProductsColumnKey[];
}
