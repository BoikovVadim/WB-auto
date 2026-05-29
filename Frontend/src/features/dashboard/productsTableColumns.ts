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
  | "orders"
  | "buyout"
  | "stock"
  | "ordersSum"
  | "revenue"
  | "costSum";

export type ProductColumnDefinition = {
  key: ProductsColumnKey;
  defaultWidth: number;
};

export const PRODUCTS_COLUMN_STORAGE_KEY = "wb-products-column-order-v2";

export const productsTableColumnDefs: ProductColumnDefinition[] = [
  { key: "index",     defaultWidth: 48  },
  { key: "nmId",      defaultWidth: 110 },
  { key: "vendorCode", defaultWidth: 130 },
  { key: "category",  defaultWidth: 160 },
  { key: "subject",   defaultWidth: 120 },
  { key: "cost",      defaultWidth: 140 },
  { key: "price",     defaultWidth: 130 },
  { key: "orders",    defaultWidth: 110 },
  { key: "buyout",    defaultWidth: 110 },
  { key: "stock",     defaultWidth: 100 },
  { key: "ordersSum", defaultWidth: 130 },
  { key: "revenue",   defaultWidth: 130 },
  { key: "costSum",   defaultWidth: 130 },
];

const PRODUCTS_COLUMN_KEYS = productsTableColumnDefs.map((c) => c.key);

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
