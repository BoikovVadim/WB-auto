import { useCallback, useRef, type RefObject } from "react";

/**
 * Ресайз колонок таблицы товаров мышью (тянуть правый край заголовка): пишет ширину
 * прямо в <col> и общую ширину в <table> через стили (вне React-стейта, чтобы тянулось
 * плавно). Вынесено из DashboardCatalogProductsSection без изменения поведения.
 */
export function useProductsColumnResize(tableRef: RefObject<HTMLTableElement | null>) {
  const resizingColRef = useRef<number | null>(null);

  return useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!tableRef.current) return;
      const colIndex = Number((event.currentTarget as HTMLElement).dataset.colIdx ?? "-1");
      if (!Number.isFinite(colIndex) || colIndex < 0) return;
      const tableEl = tableRef.current;
      const cols = tableEl.querySelectorAll<HTMLTableColElement>("colgroup col");
      if (!cols[colIndex]) return;

      const measuredColWidths = Array.from(cols).map((col) => {
        const measured = col.getBoundingClientRect().width;
        if (measured > 0) return measured;
        const parsed = Number.parseFloat(col.style.width);
        return Number.isFinite(parsed) ? parsed : 0;
      });
      const initialSelectedWidth = measuredColWidths[colIndex] ?? 0;
      const startX = event.clientX;
      resizingColRef.current = colIndex;
      document.body.style.cursor = "col-resize";

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (resizingColRef.current === null || !tableRef.current) return;
        const minWidth = 60;
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.max(minWidth, initialSelectedWidth + delta);
        const col = cols[resizingColRef.current];
        if (col) col.style.width = `${newWidth}px`;
        const totalTableWidth = measuredColWidths.reduce(
          (sum, w, i) => sum + (i === resizingColRef.current ? newWidth : w),
          0,
        );
        tableEl.style.width = `${Math.ceil(totalTableWidth)}px`;
      };

      const onMouseUp = () => {
        resizingColRef.current = null;
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp, { once: true });
    },
    [tableRef],
  );
}
