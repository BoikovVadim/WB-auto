import type { ReactNode } from "react";

import type { ClusterAutomationState } from "../../../api/syncClientClusterAutomation";

export interface AutomationPanelCounts {
  active: number;
  blacklisted: number;
  high: number;
}

/**
 * Панель статуса автоматизации кластеров по CPO — компактная компоновка:
 *   1) «режим · чекбокс Автоматизация» (метка режима — слева от флажка)
 *   2) счётчики одной строкой: актив N · чёрный N · искл. по CPO N
 *   3) кнопка действия
 * Счётчики в одну строку, чтобы блок оставался низким и при одной активной РК
 * (нет архивных кампаний → мало вертикального места) полностью помещался в шапке.
 * Кнопки действий передаются слотом `actions` (в шапке — одна, в модалке — две).
 */
export function ProductAdvertisingAutomationPanel(props: {
  mode: ClusterAutomationState | "off" | "preview" | "live";
  counts: AutomationPanelCounts;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  /** Показывать счётчики даже когда автоматизация выключена (для модалки). */
  alwaysShowCounts?: boolean;
  /** Слот действий под счётчиками (кнопки). */
  actions?: ReactNode;
  /** Сколько новых кластеров на ручной проверке (>0 → строка-CTA «на проверке N»). */
  pendingCount?: number;
  /** Клик по «на проверке N» — открыть модалку модерации. */
  onReview?: () => void;
}) {
  const isOn = props.mode !== "off";
  const countsVisible = props.alwaysShowCounts || isOn;
  // Пока идёт первый прогон движка (включили автоматизацию, данных ещё нет) показываем
  // «…», а не «0», чтобы нули не выглядели как реальный результат расчёта.
  const totalCount = props.counts.active + props.counts.blacklisted + props.counts.high;
  const loading = props.busy && totalCount === 0;
  const num = (n: number) => (loading ? "…" : String(n));

  return (
    <div className="wb-automation-panel">
      <label className="wb-automation-panel__toggle" title="Автоматическое вкл/выкл кластеров по CPO каждые 10 минут">
        {props.mode === "live" && (
          <span
            className="wb-automation-panel__mode wb-automation-panel__mode--live"
            title="Боевой режим: автоматика реально вкл/выкл кластеры на WB каждые 10 минут"
          >
            активна
          </span>
        )}
        {props.mode === "preview" && (
          <span
            className="wb-automation-panel__mode wb-automation-panel__mode--preview"
            title="Предпросмотр: автоматика считает решения, но НЕ меняет кластеры на WB. Нажмите «Включить автоматизацию», чтобы применять изменения."
          >
            предпросмотр
          </span>
        )}
        <input
          type="checkbox"
          checked={isOn}
          disabled={props.busy}
          onChange={(e) => props.onToggle(e.target.checked)}
        />
        <span>Автоматизация</span>
      </label>

      {countsVisible && (
        <div className="wb-automation-panel__counts">
          <span title="Активные + кандидаты без данных по расходу (даём шанс набрать данные)">
            актив {num(props.counts.active)}
          </span>
          <span title="Чёрный список — автоматика всегда держит выключенными">
            чёрный {num(props.counts.blacklisted)}
          </span>
          <span title="Исключены: реальный расход и CPO выше макс">
            искл. по CPO {num(props.counts.high)}
          </span>
        </div>
      )}

      {isOn && (props.pendingCount ?? 0) > 0 && (
        <button
          type="button"
          className="wb-automation-panel__pending"
          onClick={props.onReview}
          title="Новые кластеры, которые ВБ добавил в РК — ждут вашей проверки, автоматика их не трогает"
        >
          🆕 на проверке {props.pendingCount}
        </button>
      )}

      {isOn && props.actions ? <div className="wb-automation-panel__actions">{props.actions}</div> : null}
    </div>
  );
}
