/**
 * Локализация значений статуса кластера в истории изменений.
 *
 * В БД статус кластера хранится машинным enum'ом `active` / `excluded` (он же
 * используется в фильтрах и логике по всей рекламной фиче), поэтому переводим его
 * в русское слово только на отображении, а не в данных.
 */
export function clusterStatusLabel(value: string | null | undefined): string | null {
  if (value === "active") return "Активен";
  if (value === "excluded") return "Исключён";
  return value ?? null;
}
