import { useCallback, useEffect, useRef } from "react";

type ModalProps = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Ширина карточки, px. По умолчанию 640. */
  width?: number;
};

/**
 * Переиспользуемая центральная модалка: backdrop + карточка по центру.
 * Закрытие — Esc, клик по backdrop (вне карточки), крестик. Без портала —
 * рендерится в дереве вызывающего компонента (как панель истории изменений).
 */
export function Modal({ title, onClose, children, footer, width = 640 }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="wb-modal-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div ref={cardRef} className="wb-modal-card" style={{ width }}>
        <div className="wb-modal-card__header">
          <span className="wb-modal-card__title">{title}</span>
          <button
            type="button"
            className="wb-modal-card__close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>
        <div className="wb-modal-card__body">{children}</div>
        {footer ? <div className="wb-modal-card__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
