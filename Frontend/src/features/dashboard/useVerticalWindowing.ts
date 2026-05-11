import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getVerticalWindowingState } from "./verticalWindowingMath";

export function useVerticalWindowing(input: {
  rowCount: number;
  rowHeight: number;
  overscanRows?: number;
  defaultViewportHeight?: number;
  resetKey?: string | number | null;
  /**
   * Высота контента выше windowed-области в том же scroll-контейнере.
   * Используется для корректного расчёта maxScrollTop.
   */
  topOffset?: number;
}) {
  const tableWrapRef = useRef<HTMLDivElement | null>(null);

  // Latest scroll position is stored in a ref so the rAF callback always
  // reads the most recent value, even if multiple scroll events fired between frames.
  const scrollTopRef = useRef(0);
  const rafIdRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);

  const [viewportHeight, setViewportHeight] = useState(input.defaultViewportHeight ?? 480);

  const windowingState = useMemo(
    () =>
      getVerticalWindowingState({
        rowCount: input.rowCount,
        rowHeight: input.rowHeight,
        viewportHeight,
        overscanRows: input.overscanRows ?? 16,
        scrollTop,
        topOffset: input.topOffset,
      }),
    [input.overscanRows, input.rowCount, input.rowHeight, input.topOffset, scrollTop, viewportHeight],
  );

  useEffect(() => {
    const element = tableWrapRef.current;
    if (!element) {
      return;
    }

    const updateViewportHeight = () => {
      setViewportHeight(element.clientHeight || input.defaultViewportHeight || 480);
    };

    updateViewportHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      updateViewportHeight();
    });
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, [input.defaultViewportHeight, input.rowCount]);

  // Эффект клампинга намеренно удалён. windowingState уже применяет clampedScrollTop
  // при расчёте startRowIndex / endRowIndex, поэтому принудительное обновление state
  // не требуется. Запись в DOM или изменение state при каждой смене rowCount (раскрытие
  // кластера, временное обнуление данных) вызывала видимый «прыжок» таблицы.

  useEffect(() => {
    cancelAnimationFrame(rafIdRef.current);
    scrollTopRef.current = 0;
    setScrollTop(0);
    if (tableWrapRef.current) {
      tableWrapRef.current.scrollTop = 0;
    }
  }, [input.resetKey]);

  // Cleanup pending rAF on unmount.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  const windowing = useMemo(
    () => ({
      startRowIndex: windowingState.startRowIndex,
      endRowIndex: windowingState.endRowIndex,
      topSpacerHeight: windowingState.topSpacerHeight,
      bottomSpacerHeight: windowingState.bottomSpacerHeight,
    }),
    [
      windowingState.bottomSpacerHeight,
      windowingState.endRowIndex,
      windowingState.startRowIndex,
      windowingState.topSpacerHeight,
    ],
  );

  // Throttle React state updates to one per animation frame.
  // Multiple scroll events between frames are collapsed into a single re-render,
  // keeping the browser compositor free to scroll smoothly.
  const onScroll = useCallback((value: number) => {
    scrollTopRef.current = value;
    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => {
      setScrollTop(scrollTopRef.current);
    });
  }, []);

  return {
    tableWrapRef,
    onScroll,
    ...windowing,
  };
}
