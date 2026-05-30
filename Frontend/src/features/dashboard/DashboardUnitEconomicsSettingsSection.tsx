import { useEffect, useState } from "react";

import type { GlobalPercentMetric } from "../../api/syncClientUnitEconomics";
import { ui } from "./copy";
import { useUnitEconomicsSettings } from "./useUnitEconomicsSettings";

type DashboardUnitEconomicsSettingsSectionProps = {
  /** Возврат к таблице юнит-экономики. */
  onBack: () => void;
  /** Сообщить таблице, что настройки изменились (пересчитать колонки ₽). */
  onChargesInvalidate: () => void;
};

// Глобальные %-метрики (применяются ко всем товарам). Новая метрика = строка здесь
// + колонка в БД + ключ в GLOBAL_PERCENT_COLUMNS бэка + ₽-колонка в таблице.
const GLOBAL_METRICS: {
  key: GlobalPercentMetric;
  label: string;
  field: "acquiringPercent" | "drrPercent";
  hint?: string;
}[] = [
  { key: "acquiring", label: "Эквайринг", field: "acquiringPercent" },
  { key: "drr", label: "ДРР", field: "drrPercent", hint: "Доля рекламных расходов" },
];

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
        className="wb-unit-econ-percent-input"
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
  const { settings, isLoading, saveCommission, saveGlobalMetric } =
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
              Комиссия применяется по предмету товара; общие метрики (эквайринг, ДРР) — ко всем
              товарам. Все значения в % считаются от цены со скидкой.
            </p>
          </div>
        </div>

        <div className="wb-unit-econ-blocks">
          <div className="wb-unit-econ-block">
            <h3 className="wb-unit-econ-block-title">Общие метрики</h3>
            <table className="wb-data-table wb-unit-econ-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Метрика</th>
                  <th style={{ textAlign: "right", width: 170 }}>Значение, %</th>
                </tr>
              </thead>
              <tbody>
                {GLOBAL_METRICS.map((m) => (
                  <tr key={m.key}>
                    <td title={m.hint}>{m.label}</td>
                    <td style={{ textAlign: "right" }}>
                      <PercentInput
                        value={settings[m.field]}
                        ariaLabel={m.label}
                        onCommit={(next) => saveGlobalMetric(m.key, next)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="wb-unit-econ-block">
            <h3 className="wb-unit-econ-block-title">Комиссия по предметам</h3>
            {isLoading && settings.subjects.length === 0 ? (
              <p className="wb-card-meta">Загрузка…</p>
            ) : settings.subjects.length === 0 ? (
              <p className="wb-card-meta">Предметы появятся после синхронизации каталога.</p>
            ) : (
              <table className="wb-data-table wb-unit-econ-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Предмет</th>
                    <th style={{ textAlign: "right", width: 170 }}>Комиссия, %</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.subjects.map((s) => (
                    <tr key={s.subject}>
                      <td>{s.subject}</td>
                      <td style={{ textAlign: "right" }}>
                        <PercentInput
                          value={s.commissionPercent}
                          ariaLabel={`Комиссия для предмета ${s.subject}`}
                          onCommit={(next) => saveCommission(s.subject, next)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
