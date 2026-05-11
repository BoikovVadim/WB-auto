export function getVerticalWindowingState(input: {
  rowCount: number;
  rowHeight: number;
  viewportHeight: number;
  overscanRows: number;
  scrollTop: number;
  /**
   * Высота контента, расположенного ВЫШЕ windowed-области внутри того же
   * scroll-контейнера (например, sticky-заголовок таблицы).
   * Без этого параметра maxScrollTop недооценивается, и последние строки
   * становятся недостижимыми через прокрутку.
   */
  topOffset?: number;
}) {
  const topOffset = Math.max(0, input.topOffset ?? 0);
  const safeRowCount = Math.max(0, input.rowCount);
  const safeRowHeight = Math.max(1, input.rowHeight);
  const safeViewportHeight = Math.max(safeRowHeight, input.viewportHeight);
  const safeOverscanRows = Math.max(0, input.overscanRows);
  const visibleRowCount = Math.max(
    1,
    Math.ceil(safeViewportHeight / safeRowHeight) + safeOverscanRows * 2,
  );
  // maxScrollTop учитывает topOffset: реальная максимальная прокрутка включает
  // высоту заголовка поверх body-строк.
  const maxScrollTop = Math.max(0, safeRowCount * safeRowHeight + topOffset - safeViewportHeight);
  const clampedScrollTop = Math.min(Math.max(0, input.scrollTop), maxScrollTop);
  // bodyScrollTop — прокрутка относительно начала body-строк (без заголовка).
  const bodyScrollTop = Math.max(0, clampedScrollTop - topOffset);
  const unclampedStartRowIndex = Math.max(
    0,
    Math.floor(bodyScrollTop / safeRowHeight) - safeOverscanRows,
  );
  const maxStartRowIndex = Math.max(0, safeRowCount - visibleRowCount);
  const startRowIndex = Math.min(unclampedStartRowIndex, maxStartRowIndex);
  const endRowIndex = Math.min(safeRowCount, startRowIndex + visibleRowCount);

  return {
    visibleRowCount,
    clampedScrollTop,
    maxScrollTop,
    startRowIndex,
    endRowIndex,
    topSpacerHeight: startRowIndex * safeRowHeight,
    bottomSpacerHeight: Math.max(0, (safeRowCount - endRowIndex) * safeRowHeight),
  };
}
