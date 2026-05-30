import type { WbExportListItem } from "../../api/syncClient";

/**
 * Сортировка истории выгрузок: новейшие сверху (по exportedAt; при равенстве/невалидных
 * датах — по requestId). Общий хелпер для WbDashboard / useDashboardBootstrap /
 * useDashboardExportActions (раньше дублировался в каждом).
 */
export function sortExportHistoryNewestFirst(items: WbExportListItem[]): WbExportListItem[] {
  return [...items].sort((left, right) => {
    const leftMs = Date.parse(left.exportedAt);
    const rightMs = Date.parse(right.exportedAt);
    if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
      return rightMs - leftMs;
    }
    return right.requestId.localeCompare(left.requestId, "en");
  });
}
