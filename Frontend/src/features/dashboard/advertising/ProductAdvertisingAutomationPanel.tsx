import { useState, type ReactNode } from "react";

import type { ClusterAutomationState } from "../../../api/syncClientClusterAutomation";
import { Modal } from "../../../components/Modal";

export interface AutomationPanelCounts {
  active: number;
  blacklisted: number;
  high: number;
  /** Придержаны регулятором дневного ДРР (excluded_drr) — рентабельные, временно выключены. */
  drrHeld: number;
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
  // Выключение автоматики — только через подтверждение (раньше один случайный клик молча
  // отключал её, отсюда жалобы «само отключилось»). Включение — сразу, без диалога.
  const [confirmOff, setConfirmOff] = useState(false);
  const handleToggle = (enabled: boolean) => {
    if (enabled) {
      props.onToggle(true);
    } else {
      setConfirmOff(true);
    }
  };
  // Пока идёт запрос (включение/пересчёт) показываем «…», а НЕ предыдущие числа: при
  // переключении оптимистичный апдейт держит старые (устаревшие с прошлого прогона)
  // счётчики, и без этого они мелькали как настоящие до прихода свежего ответа сервера.
  const loading = props.busy;
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
          onChange={(e) => handleToggle(e.target.checked)}
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
          <span title="Придержаны регулятором дневного ДРР: рентабельные кластеры, временно выключены ради удержания дневного ДРР товара у плана — вернутся сами, когда ДРР опустится">
            придержано {num(props.counts.drrHeld)}
          </span>
        </div>
      )}

      {isOn && ((props.pendingCount ?? 0) > 0 || props.actions) && (
        <div className="wb-automation-panel__bottom-row">
          {(props.pendingCount ?? 0) > 0 && (
            <button
              type="button"
              className="wb-automation-panel__pending"
              onClick={props.onReview}
              title="Новые кластеры, которые ВБ добавил в РК — ждут вашей проверки, автоматика их не трогает"
            >
              🆕 на проверке {props.pendingCount}
            </button>
          )}
          {props.actions}
        </div>
      )}

      {confirmOff && (
        <Modal
          title="Выключить автоматизацию?"
          width={420}
          onClose={() => setConfirmOff(false)}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="wb-automation-confirm__btn"
                onClick={() => setConfirmOff(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="wb-automation-confirm__btn wb-automation-confirm__btn--danger"
                onClick={() => {
                  setConfirmOff(false);
                  props.onToggle(false);
                }}
              >
                Выключить
              </button>
            </div>
          }
        >
          <p style={{ margin: 0, fontSize: 13, color: "var(--wb-text-main)" }}>
            Автоматика перестанет управлять ставками и составом кластеров. Боевые кампании
            останутся в текущем состоянии, пока вы не включите автоматизацию снова.
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--wb-text-muted)" }}>
            Действие запишется в Историю изменений.
          </p>
        </Modal>
      )}
    </div>
  );
}
