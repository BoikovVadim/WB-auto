import { memo, useCallback, useEffect, useRef, useState } from "react";

import { formatMoney } from "../../formatters";
import type { CurrentPriceEntry } from "./useCurrentPrices";
import type { PriceChangeStatus } from "../../api/syncClientPrices";

export function SortArrow({
  active,
  direction,
}: {
  active: boolean;
  direction: "asc" | "desc";
}) {
  return (
    <span className={active ? "wb-sort-arrow--active" : "wb-sort-arrow--inactive"}>
      {active ? (direction === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );
}

type CostInputCellProps = {
  nmId: number;
  savedValue: number | null;
  isSelected: boolean;
  isEditing: boolean;
  /** Редактирование доступно только в «Юнит Экономика». В «Товары» — read-only
   *  отображение того же значения (без карандаша и инлайн-ввода). */
  editable: boolean;
  onSaved: (nmId: number, value: number) => Promise<void>;
  onCommitEdit: () => void;
  /** Enter edit mode — вызывается кликом по карандашу слева от значения.
   *  Принимает nmId, чтобы родитель мог передать ОДИН стабильный колбэк на все
   *  ячейки и не ломать memo (инлайн-стрелка пересоздавалась бы каждый рендер). */
  onStartEdit: (nmId: number) => void;
};

export const CostInputCell = memo(function CostInputCell({
  nmId,
  savedValue,
  isSelected,
  isEditing,
  editable,
  onSaved,
  onCommitEdit,
  onStartEdit,
}: CostInputCellProps) {
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const savedValueRef = useRef(savedValue);
  useEffect(() => {
    savedValueRef.current = savedValue;
  }, [savedValue]);

  const startDraft = useCallback(() => {
    setDraft(savedValueRef.current !== null ? String(savedValueRef.current) : "");
  }, []);

  useEffect(() => {
    if (isEditing) {
      startDraft();
    }
  }, [isEditing, startDraft]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const commit = useCallback(async () => {
    const trimmed = draft.trim().replace(",", ".");
    const currentSaved = savedValueRef.current;
    if (trimmed === "") {
      onCommitEdit();
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      onCommitEdit();
      return;
    }
    if (parsed === currentSaved) {
      onCommitEdit();
      return;
    }
    setSaving(true);
    try {
      await onSaved(nmId, parsed);
      onCommitEdit();
    } catch {
      // keep editing so user can retry
    } finally {
      setSaving(false);
    }
  }, [draft, nmId, onSaved, onCommitEdit]);

  if (editable && isEditing) {
    return (
      <input
        ref={inputRef}
        className={`wb-cost-price-input${saving ? " wb-cost-price-input--saving" : ""}`}
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder="0"
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { void commit(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            onCommitEdit();
          }
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Себестоимость"
      />
    );
  }

  return (
    <span
      className={`wb-cost-price-display${isSelected ? " wb-cost-price-display--selected" : ""}`}
    >
      {editable && (
        <button
          type="button"
          className="wb-cost-price-edit-icon"
          title="Изменить себестоимость"
          aria-label="Изменить себестоимость"
          tabIndex={-1}
          onMouseDown={(e) => { e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); onStartEdit(nmId); }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      )}
      <span className="wb-cost-price-value">
        {savedValue !== null
          ? `${savedValue.toLocaleString("ru-RU")} ₽`
          : <span className="wb-cost-price-empty">—</span>}
      </span>
    </span>
  );
});

// ─── Калькулятор: ячейка-ввод «что если» (целевая маржа % / гипотетическая цена) ──
// Поведение как в Google Sheets: пока печатаешь — только локальный draft, расчёт НЕ идёт;
// значение применяется (и расчёт запускается) при выходе из ячейки — Enter или клик вне
// (blur). Escape — отмена правки и возврат к прежнему значению. Во время фокуса проп
// игнорируется (как PercentInput в настройках). Расчёт рисует соседняя read-only колонка.

export const CalcInputCell = memo(function CalcInputCell({
  nmId,
  savedValue,
  onChange,
  ariaLabel,
}: {
  nmId: number;
  savedValue: number | null;
  onChange: (nmId: number, value: number | null) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(savedValue !== null ? String(savedValue) : "");
  const focusedRef = useRef(false);
  // Escape ставит флаг, чтобы blur-коммит после отмены не применил откатанный draft.
  const skipCommitRef = useRef(false);
  const savedValueRef = useRef(savedValue);
  useEffect(() => {
    savedValueRef.current = savedValue;
  }, [savedValue]);

  // Перечитываем проп только вне фокуса (скролл-возврат / внешнее изменение); во время
  // набора локальный draft — источник истины.
  useEffect(() => {
    if (!focusedRef.current) setDraft(savedValue !== null ? String(savedValue) : "");
  }, [savedValue]);

  // Применяем введённое: пусто → сброс (null), иначе число. Зовётся на Enter/blur, не на ввод.
  const commit = useCallback(() => {
    const trimmed = draft.trim().replace(",", ".");
    if (trimmed === "") {
      onChange(nmId, null);
      return;
    }
    const parsed = Number(trimmed);
    onChange(nmId, Number.isFinite(parsed) ? parsed : null);
  }, [draft, nmId, onChange]);

  return (
    <input
      className="wb-cost-price-input"
      type="text"
      inputMode="decimal"
      value={draft}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => {
        focusedRef.current = false;
        if (skipCommitRef.current) {
          skipCommitRef.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur(); // выход из ячейки → blur применит значение и запустит расчёт
        } else if (e.key === "Escape") {
          e.preventDefault();
          skipCommitRef.current = true;
          setDraft(savedValueRef.current !== null ? String(savedValueRef.current) : "");
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
    />
  );
});

// ─── Price edit cell (запись на маркетплейс WB) ───────────────────────────────
// Клик по числу или карандашу → инлайн-ввод. Enter → модалка подтверждения
// (подтверждение/отмена живут в родителе). Без статусов и без readback: значение
// фиксируется в таблице оптимистично (overlay), WB применяет цену сам.

export const PriceInputCell = memo(function PriceInputCell({
  nmId,
  entry,
  overlay,
  isEditing,
  editable,
  onStartEdit,
  onCommitEdit,
  onRequestConfirm,
}: {
  nmId: number;
  entry: CurrentPriceEntry | undefined;
  /** Последняя выставленная пользователем цена — показываем её оптимистично. */
  overlay: PriceChangeStatus | undefined;
  isEditing: boolean;
  /** Запись цены на WB доступна только в «Юнит Экономика». В «Товары» — read-only. */
  editable: boolean;
  onStartEdit: (nmId: number) => void;
  onCommitEdit: () => void;
  onRequestConfirm: (nmId: number, targetFinal: number) => void;
}) {
  const [draft, setDraft] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Цена в ячейке: если пользователь уже выставлял цену — показываем его значение
  // (оптимистично, переживает перезагрузку), иначе последний снапшот.
  const currentFinal: number | null =
    overlay ? overlay.desiredFinal : (entry?.priceWithDiscount ?? null);
  const currentFinalRef = useRef(currentFinal);
  useEffect(() => { currentFinalRef.current = currentFinal; }, [currentFinal]);

  useEffect(() => {
    if (isEditing) setDraft(currentFinalRef.current !== null ? String(currentFinalRef.current) : "");
  }, [isEditing]);
  useEffect(() => {
    if (isEditing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [isEditing]);

  const submit = useCallback(() => {
    const t = draft.trim().replace(",", ".");
    if (t === "") { onCommitEdit(); return; }
    const target = Number(t);
    if (!Number.isFinite(target) || target <= 0) { onCommitEdit(); return; }
    // No-op только если введено РОВНО текущее значение ячейки (можно ставить любое
    // другое число, в т.ч. равное исходной цене до прежних правок).
    if (currentFinalRef.current !== null && Math.abs(target - currentFinalRef.current) < 0.005) {
      onCommitEdit();
      return;
    }
    onRequestConfirm(nmId, target);
  }, [draft, nmId, onRequestConfirm, onCommitEdit]);

  if (editable && isEditing) {
    return (
      <input
        ref={inputRef}
        className="wb-cost-price-input"
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder="0"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { submit(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          else if (e.key === "Escape") { onCommitEdit(); }
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Цена со скидкой продавца"
      />
    );
  }

  return (
    <span
      className="wb-cost-price-display"
      style={editable ? { cursor: "pointer" } : undefined}
      role={editable ? "button" : undefined}
      tabIndex={editable ? -1 : undefined}
      onClick={editable ? (e) => { e.stopPropagation(); onStartEdit(nmId); } : undefined}
    >
      {editable && (
        <button
          type="button"
          className="wb-cost-price-edit-icon"
          title="Изменить цену и отправить на маркетплейс WB"
          aria-label="Изменить цену"
          tabIndex={-1}
          onMouseDown={(e) => { e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); onStartEdit(nmId); }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      )}
      <span className="wb-cost-price-value">
        {currentFinal !== null
          ? formatMoney(currentFinal)
          : <span className="wb-cost-price-empty">—</span>}
      </span>
    </span>
  );
});

// ─── Модалка подтверждения изменения цены ─────────────────────────────────────
// Всплывает после Enter в поле. Enter — применить, Esc/Отмена/клик по фону — закрыть
// без изменений. Кнопка «Поставить» в фокусе, поэтому Enter применяет сразу.

export const PriceConfirmModal = memo(function PriceConfirmModal({
  productLabel,
  oldFinal,
  shelf,
  onConfirm,
  onCancel,
}: {
  productLabel: string;
  oldFinal: number | null;
  shelf: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div
      className="wb-price-confirm-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        else if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
      }}
    >
      <div className="wb-price-confirm" role="dialog" aria-modal="true">
        <div className="wb-price-confirm-title">Изменить цену на маркетплейсе WB</div>
        <div className="wb-price-confirm-body">
          <div className="wb-price-confirm-product">{productLabel}</div>
          <div className="wb-price-confirm-prices">
            {oldFinal !== null && (
              <span className="wb-price-confirm-old">{formatMoney(oldFinal)}</span>
            )}
            <span className="wb-price-confirm-arrow">→</span>
            <span className="wb-price-confirm-new">{formatMoney(shelf)}</span>
          </div>
          <div className="wb-price-confirm-note">Фактическая цена со скидкой на WB станет {formatMoney(shelf)}.</div>
        </div>
        <div className="wb-price-confirm-actions">
          <button type="button" className="wb-btn-secondary" onClick={onCancel}>
            Отмена
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="wb-btn-primary"
            onClick={onConfirm}
          >
            Поставить
          </button>
        </div>
      </div>
    </div>
  );
});
