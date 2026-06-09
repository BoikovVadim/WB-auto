import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/**
 * Переиспользуемая строковая виртуализация для простых таблиц: в DOM только видимое окно
 * (+overscan), верх/низ держат спейсер-`<tr>`. Тот же приём, что в RawTableSection — вынесен,
 * чтобы кастомные таблицы (Кампании/JAM и т.п.) не дублировали логику. Требует bounded-höhe
 * скролл-контейнер (повесь возвращённый scrollRef на `<div style={{overflow:auto,maxHeight}}>`).
 *
 * resetKey — при смене (поиск/сортировка/фильтр) список прыгает к началу, чтобы окно не
 * «зависало» на старом offset поверх нового, более короткого списка.
 */
export function useVirtualRows(count: number, rowHeight: number, resetKey?: unknown) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = items.length > 0 ? (items[0]?.start ?? 0) : 0;
  const paddingBottom =
    items.length > 0 ? totalSize - (items[items.length - 1]?.end ?? 0) : 0;

  useEffect(() => {
    virtualizer.scrollToOffset(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [resetKey, virtualizer]);

  return { scrollRef, items, paddingTop, paddingBottom };
}
