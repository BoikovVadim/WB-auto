import { useEffect, useState } from "react";

import { ui } from "./copy";
import { useUnitEconomicsSettings } from "./useUnitEconomicsSettings";

type DashboardUnitEconomicsSettingsSectionProps = {
  /** Возврат к таблице юнит-экономики. */
  onBack: () => void;
  /** Сообщить таблице, что комиссия/эквайринг изменились (пересчитать колонки ₽). */
  onChargesInvalidate: () => void;
};

// ─── Ячейка ввода процента ───────────────────────────────────────────────────
// Контролируемый инпут: коммит по blur/Enter (2 знака после запятой), revert по
// Escape. Пустая строка = очистить (null). Невалидное/вне [0..100] → revert.

type PercentInputProps = {
  value: number | null;
  ariaLabel: string;
  onCommit: (next: number | null) => Promise<void>;
};

function PercentInput({ value, ariaLabel, onCommit }: PercentInputProps) {
  const [draft, setDraft] = useState<string>(() => (value === null ? "" : value.toFixed(2)));
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);

  // Подхватываем новое значение из пропа, пока поле не в фокусе (напр. после загрузки).
  useEffect(() => {
    if (!focused) setDraft(value === null ? "" : value.toFixed(2));
  }, [value, focused]);

  const revert = () => setDraft(value === null ? "" : value.toFixed(2));

  const commit = () => {
    const trimmed = draft.trim().replace(",", ".");
    let next: number | null;
    if (trimmed === "") {
      next = null;
    } else {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        revert();
        return;
      }
      next = Math.round(parsed * 100) / 100;
    }
    if (next === value) {
      revert();
      return;
    }
    setSaving(true);
    onCommit(next)
      .catch(() => revert())
      .finally(() => setSaving(false));
  };

  return (
    <span className="wb-unit-econ-percent">
      <input
        className="wb-input wb-unit-econ-percent-input"
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={draft}
        disabled={saving}
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            revert();
            e.currentTarget.blur();
          }
        }}
      />
      <span className="wb-unit-econ-percent-suffix">%</span>
    </span>
  );
}

// ─── Секция настроек юнит-экономики ──────────────────────────────────────────

export function DashboardUnitEconomicsSettingsSection({
  onBack,
  onChargesInvalidate,
}: DashboardUnitEconomicsSettingsSectionProps) {
  const { settings, isLoading, saveCommission, saveAcquiring } =
    useUnitEconomicsSettings(onChargesInvalidate);

  return (
    <div className="wb-exports-scroll">
      <div>
        <button className="wb-secondary-button" onClick={onBack}>
          ← Назад к таблице
        </button>
      </div>

      <section className="wb-card" style={{ padding: "clamp(12px, 1vw, 16px)" }}>
        <div className="wb-card-header">
          <div>
            <h2>{ui.viewUnitEconomicsTitle}</h2>
            <p className="wb-card-meta">
              Комиссия применяется по категории товара, эквайринг — ко всем товарам.
            </p>
          </div>
        </div>

        <div className="wb-unit-econ-block">
          <h3 className="wb-unit-econ-block-title">Комиссия по категориям</h3>
          {isLoading && settings.categories.length === 0 ? (
            <p className="wb-card-meta">Загрузка…</p>
          ) : settings.categories.length === 0 ? (
            <p className="wb-card-meta">Категории появятся после синхронизации каталога.</p>
          ) : (
            <table className="wb-data-table wb-unit-econ-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Категория</th>
                  <th style={{ textAlign: "right", width: 170 }}>Комиссия, %</th>
                </tr>
              </thead>
              <tbody>
                {settings.categories.map((c) => (
                  <tr key={c.category}>
                    <td>{c.category}</td>
                    <td style={{ textAlign: "right" }}>
                      <PercentInput
                        value={c.commissionPercent}
                        ariaLabel={`Комиссия для категории ${c.category}`}
                        onCommit={(next) => saveCommission(c.category, next)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="wb-unit-econ-block">
          <h3 className="wb-unit-econ-block-title">Эквайринг</h3>
          <div className="wb-unit-econ-acquiring-row">
            <span className="wb-unit-econ-acquiring-label">Эквайринг, %</span>
            <PercentInput
              value={settings.acquiringPercent}
              ariaLabel="Эквайринг"
              onCommit={(next) => saveAcquiring(next)}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
