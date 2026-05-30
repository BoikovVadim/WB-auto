import { useCallback, useRef } from "react";

/**
 * Механизм синхронного скролла зон «замороженной» таблицы (frozen-pane), как в
 * [VirtualMatrixTable](./VirtualMatrixTable.tsx): тело — единственная зона с нативным
 * скроллом, а закреплённые зоны (шапка по X, левые колонки по Y) двигаются ТОЛЬКО через
 * `transform: translate3d` на внутреннем div — это GPU-композит, без paint каждый кадр
 * (в отличие от `position: sticky`, который браузер перерисовывает попиксельно).
 *
 * Колесо над любой закреплённой зоной форвардится в тело с `preventDefault` (иначе
 * compositor скроллил бы body мимо JS и зеркала отставали бы на кадр). `syncMirrors`
 * зовём в том же обработчике — без ожидания scroll-события.
 *
 * Переиспользуемо: подходит для любой таблицы с одной горизонтальной шапкой-зеркалом
 * и одной вертикальной левой зоной-зеркалом.
 */
export function useFrozenPaneSync() {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const headerInnerRef = useRef<HTMLDivElement | null>(null);
  const leftInnerRef = useRef<HTMLDivElement | null>(null);
  // Элементы, на которые wheel-форвардер уже навешен — чтобы не вешать дважды при ре-рендерах.
  const wheelAttachedRef = useRef<WeakSet<HTMLElement>>(new WeakSet());

  const syncMirrors = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const sl = el.scrollLeft;
    const st = el.scrollTop;
    if (headerInnerRef.current) {
      headerInnerRef.current.style.transform = `translate3d(${String(-sl)}px, 0, 0)`;
    }
    if (leftInnerRef.current) {
      leftInnerRef.current.style.transform = `translate3d(0, ${String(-st)}px, 0)`;
    }
  }, []);

  const attachWheel = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      if (wheelAttachedRef.current.has(el)) return;
      wheelAttachedRef.current.add(el);
      el.addEventListener(
        "wheel",
        (e: WheelEvent) => {
          const body = bodyRef.current;
          if (!body) return;
          e.preventDefault();
          body.scrollLeft += e.deltaX;
          body.scrollTop += e.deltaY;
          syncMirrors();
        },
        { passive: false },
      );
    },
    [syncMirrors],
  );

  // Ref-колбэк для тела: запоминаем элемент и тоже навешиваем wheel-форвардер
  // (чтобы колесо над body вело себя одинаково и зеркала двигались в том же кадре).
  const setBodyRef = useCallback(
    (el: HTMLDivElement | null) => {
      bodyRef.current = el;
      attachWheel(el);
    },
    [attachWheel],
  );

  return { bodyRef, headerInnerRef, leftInnerRef, setBodyRef, attachWheel, syncMirrors };
}
