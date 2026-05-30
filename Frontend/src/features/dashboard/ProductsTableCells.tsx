import { memo, useCallback, useEffect, useRef, useState } from "react";

import { formatMoney } from "../../formatters";
import type { CurrentPriceEntry } from "./useCurrentPrices";
import type { PriceChangeStatus } from "../../api/syncClientPrices";
import type { EditableColumnKey } from "./useProductsTableSelection";

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
  isEditing: boolean;
  /** Редактирование доступно только в «Юнит Экономика». В «Товары» — read-only
   *  отображение того же значения (без карандаша и инлайн-ввода). */
  editable: boolean;
  /** Первый набранный символ (правка набором, Sheets): ячейка стартует с него; иначе null. */
  initialChar: string | null;
  onSaved: (nmId: number, value: number) => Promise<void>;
  onCommitEdit: () => void;
  /** Вход в правку — карандаш. ОДИН стабильный колбэк на все ячейки (memo цел). */
  onStartEdit: (nmId: number) => void;
};

export const CostInputCell = memo(function CostInputCell({
  nmId,
  savedValue,
  isEditing,
  editable,
  initialChar,
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

  // Старт правки: набором — с введённого символа, иначе — с текущего значения.
  useEffect(() => {
    if (!isEditing) return;
    setDraft(initialChar ?? (savedValueRef.current !== null ? String(savedValueRef.current) : ""));
  }, [isEditing, initialChar]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      if (initialChar) {
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange(len, len); // курсор в конец, дальше дописывает
      } else {
        inputRef.current.select(); // выделить всё — следующий ввод заменит
      }
    }
  }, [isEditing, initialChar]);

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
    <span className="wb-cost-price-display">
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

// ─── Калькулятор: ячейка «что если» (целевая маржа % / гипотетическая цена) ──
// Как ячейка Google Sheets: вне правки — просто значение (можно выделять/очищать рамкой);
// правка по двойному клику / Enter / набору (isEditing управляет родитель). В режиме правки
// — инпут; пока печатаешь, расчёт НЕ идёт, применяется при выходе из ячейки (Enter или клик
// вне → blur), затем запускается расчёт. Escape — отмена правки без применения.

export const CalcInputCell = memo(function CalcInputCell({
  nmId,
  colKey,
  savedValue,
  isEditing,
  initialChar,
  onChange,
  onCommitEdit,
  onStartEdit,
  format,
  ariaLabel,
}: {
  nmId: number;
  colKey: EditableColumnKey;
  savedValue: number | null;
  isEditing: boolean;
  initialChar: string | null;
  onChange: (nmId: number, value: number | null) => void;
  onCommitEdit: () => void;
  /** Вход в правку — карандаш. ОДИН стабильный колбэк на все ячейки (memo цел). */
  onStartEdit: (nmId: number, colKey: EditableColumnKey) => void;
  /** Формат отображения вне правки: % для маржи, ₽ для цены (как у себестоимости/цены). */
  format: (value: number) => string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const savedValueRef = useRef(savedValue);
  useEffect(() => {
    savedValueRef.current = savedValue;
  }, [savedValue]);
  // Escape — выйти без применения (blur не должен закоммитить откатанное значение).
  const skipCommitRef = useRef(false);

  useEffect(() => {
    if (!isEditing) return;
    setDraft(initialChar ?? (savedValueRef.current !== null ? String(savedValueRef.current) : ""));
  }, [isEditing, initialChar]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      if (initialChar) {
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange(len, len);
      } else {
        inputRef.current.select();
      }
    }
  }, [isEditing, initialChar]);

  // Применяем введённое и выходим из правки. Зовётся по Enter/blur, не на каждый символ.
  const commit = useCallback(() => {
    const trimmed = draft.trim().replace(",", ".");
    if (trimmed === "") onChange(nmId, null);
    else {
      const parsed = Number(trimmed);
      onChange(nmId, Number.isFinite(parsed) ? parsed : null);
    }
    onCommitEdit();
  }, [draft, nmId, onChange, onCommitEdit]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="wb-cost-price-input"
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (skipCommitRef.current) {
            skipCommitRef.current = false;
            onCommitEdit();
            return;
          }
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            skipCommitRef.current = true;
            e.currentTarget.blur();
          }
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <span className="wb-cost-price-display">
      <button
        type="button"
        className="wb-cost-price-edit-icon"
        title="Изменить"
        aria-label={`Изменить — ${ariaLabel}`}
        tabIndex={-1}
        onMouseDown={(e) => { e.stopPropagation(); }}
        onClick={(e) => { e.stopPropagation(); onStartEdit(nmId, colKey); }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </button>
      <span className="wb-cost-price-value">
        {savedValue !== null ? format(savedValue) : <span className="wb-cost-price-empty">—</span>}
      </span>
    </span>
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
