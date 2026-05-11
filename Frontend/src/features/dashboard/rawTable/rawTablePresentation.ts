import { ui } from "../copy";

export function getRawTableColumnClass(columnIndex: number, column: string) {
  if (columnIndex === 0) {
    return "wb-raw-table-column wb-raw-table-column--sticky-first";
  }

  if (columnIndex === 1) {
    return "wb-raw-table-column wb-raw-table-column--sticky-second";
  }

  if (column === "vendorCode" || column === "text") {
    return "wb-raw-table-column";
  }

  return "";
}

export function formatRawCellValue(value: unknown) {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? ui.yes : ui.no;
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return JSON.stringify(value);
}

export function isNumericTableValue(value: unknown) {
  return typeof value === "number";
}

export function matchesRawTableSearch(
  row: Record<string, unknown>,
  normalizedQuery: string,
) {
  const searchableKeys = [
    "name",
    "vendorCode",
    "text",
    "brandName",
    "subjectName",
    "nmId",
  ] as const;

  for (const key of searchableKeys) {
    const value = row[key];
    if (typeof value === "string" && value.toLocaleLowerCase("ru").includes(normalizedQuery)) {
      return true;
    }
    if (typeof value === "number" && String(value).includes(normalizedQuery)) {
      return true;
    }
  }

  return false;
}

export function formatRawColumnLabel(column: string) {
  const segments = column.split(".");
  return segments.map((segment) => translateWbColumnSegment(segment)).join(" / ");
}

function translateWbColumnSegment(segment: string) {
  const labelMap: Record<string, string> = {
    text: "Поисковая фраза",
    nmId: "WB nmId",
    name: "Название",
    vendorCode: "Артикул продавца",
    brandName: "Бренд",
    subjectName: "Предмет",
    mainPhoto: "Главное фото",
    isAdvertised: "Реклама",
    isSubstitutedSKU: "Подменный SKU",
    isCardRated: "Есть рейтинг карточки",
    rating: "Рейтинг",
    feedbackRating: "Рейтинг отзывов",
    price: "Цена",
    minPrice: "мин.",
    maxPrice: "макс.",
    frequency: "Частотность",
    weekFrequency: "Частотность за неделю",
    medianPosition: "Медианная позиция",
    avgPosition: "Средняя позиция",
    openCard: "Открытия карточки",
    addToCart: "Добавления в корзину",
    openToCart: "Конверсия в корзину",
    orders: "Заказанные товары, шт",
    cartToOrder: "Конверсия в заказ",
    visibility: "Видимость",
    currency: "Валюта",
    current: "текущее",
    dynamics: "динамика",
    percentile: "перцентиль",
  };

  return labelMap[segment] ?? segment;
}
