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

/**
 * Человекочитаемая подпись причины авто-смены ставки движком (машинный enum из
 * computeDesiredBid: up/down/at_cap/at_min/frozen/unprofitable). Единый источник для
 * Истории изменений и модалки «Предложения движка». null/неизвестное → null (фронт «—»).
 */
export function bidReasonLabel(value: string | null | undefined): string | null {
  switch (value) {
    case "up":
      return "повышаем ↑";
    case "down":
      return "понижаем ↓";
    case "at_cap":
      return "на потолке";
    case "at_min":
      return "на минимуме";
    case "frozen":
      return "замер не удался (повтор)";
    case "unprofitable":
      return "убыточно (CR низкая)";
    default:
      return value ?? null;
  }
}
