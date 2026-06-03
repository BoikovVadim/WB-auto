import type { ProductAdvertisingSheetResponse } from "./types/product-advertising-sheet.types";

/**
 * Срезает тяжёлый список clusterQueries из ответа эндпоинта /advertising-sheet.
 * Фронт этот лист НЕ читает (только валидирует как массив — пустой проходит): таблицы
 * кластеров и drilldown запросов берут данные из отдельных SQL-direct эндпоинтов
 * (workspace-cluster-table / workspace-cluster-queries). А для «горячего» товара лист
 * — до 216k строк (десятки МБ JSON), которые клиент скачивает, парсит и кладёт в
 * IndexedDB только чтобы выбросить. summary.clusterQueriesCount (число) сохраняется,
 * поэтому индикаторы/«пусто» работают.
 *
 * Применять ТОЛЬКО на границе HTTP-ответа: внутри бэкенда clusterQueries — источник
 * для JAM-оверлея, частот и материализации снапшота, там лист обязателен. Стрип
 * ставится после всех внутренних вычислений.
 */
export function stripHeavyUnusedSheetFields(
  sheet: ProductAdvertisingSheetResponse,
): ProductAdvertisingSheetResponse {
  if (!sheet.clusterQueries || sheet.clusterQueries.length === 0) {
    return sheet;
  }
  return { ...sheet, clusterQueries: [] };
}
