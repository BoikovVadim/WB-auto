import { useCallback, useEffect, useRef, useState } from "react";
import type { ClusterChangeLogEntry } from "../../../api/syncClientAdvertisingRead";
import { fetchClusterChangeLog } from "../../../api/syncClientAdvertisingRead";
import {
  automationModeLabel,
  bidReasonLabel,
  clusterStatusLabel,
  reasonToneClass,
} from "../changeLogLabels";

type Props = {
  nmId: number;
  advertId: number;
  onClose: () => void;
};

function formatChangeType(entry: ClusterChangeLogEntry): string {
  if (entry.changeType === "automation_mode") return "Автоматизация";
  if (entry.changeType === "bid_change") {
    return "Смена ставки";
  }
  if (entry.newValue === "active") return "Включение";
  if (entry.newValue === "excluded") return "Исключение";
  return "Изменение статуса";
}

function formatChangeValue(entry: ClusterChangeLogEntry): string {
  if (entry.changeType === "automation_mode") {
    return `${automationModeLabel(entry.oldValue)} → ${automationModeLabel(entry.newValue)}`;
  }
  if (entry.changeType === "bid_change") {
    if (entry.oldValue !== null) {
      return `${entry.oldValue} → ${entry.newValue} ₽`;
    }
    return `→ ${entry.newValue} ₽`;
  }
  return `→ ${clusterStatusLabel(entry.newValue) ?? entry.newValue}`;
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return isoString;
  }
}

function getChangeToneClass(entry: ClusterChangeLogEntry): string {
  if (entry.changeType === "bid_change") return "wb-change-log-badge--bid";
  // Автоматизация: выключение (off) — красный тон, включение (preview/live) — зелёный.
  if (entry.changeType === "automation_mode") {
    return entry.newValue === "off"
      ? "wb-change-log-badge--exclude"
      : "wb-change-log-badge--include";
  }
  if (entry.newValue === "active") return "wb-change-log-badge--include";
  return "wb-change-log-badge--exclude";
}

/** Кто инициировал смену: вручную или движок (старые записи без метки → «—»). */
function formatInitiator(entry: ClusterChangeLogEntry): string {
  if (entry.initiatedBy === "automation") return "Авто";
  if (entry.initiatedBy === "user") return "Вы";
  return "—";
}

/** Замеренная позиция на момент авто-смены ставки: «#N», «>100» или «—». */
function formatPosition(position: number | null): string {
  if (position === null) return "—";
  return position > 100 ? ">100" : `#${String(position)}`;
}

export function ProductAdvertisingChangeLogPanel({ nmId, advertId, onClose }: Props) {
  const [entries, setEntries] = useState<ClusterChangeLogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchClusterChangeLog(nmId, advertId)
      .then((data) => {
        setEntries(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError((err as Error).message ?? "Ошибка загрузки истории");
        setLoading(false);
      });
  }, [nmId, advertId]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
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
      className="wb-change-log-backdrop"
      onClick={handleBackdropClick}
      aria-modal="true"
      role="dialog"
      aria-label="История изменений"
    >
      <div ref={panelRef} className="wb-change-log-panel">
        <div className="wb-change-log-panel__header">
          <span className="wb-change-log-panel__title">История изменений</span>
          <button
            type="button"
            className="wb-change-log-panel__close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="wb-change-log-panel__body">
          {loading ? (
            <div className="wb-change-log-empty">Загрузка...</div>
          ) : error ? (
            <div className="wb-change-log-empty wb-change-log-empty--error">{error}</div>
          ) : !entries || entries.length === 0 ? (
            <div className="wb-change-log-empty">История изменений пуста</div>
          ) : (
            <table className="wb-change-log-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Кластер</th>
                  <th>Тип</th>
                  <th>Значение</th>
                  <th className="wb-change-log-th--center">Позиция</th>
                  <th className="wb-change-log-th--center">Причина</th>
                  <th className="wb-change-log-th--center">Инициатор</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="wb-change-log-td wb-change-log-td--date">
                      {formatDate(entry.appliedAt)}
                    </td>
                    <td className="wb-change-log-td wb-change-log-td--cluster" title={entry.clusterName}>
                      {entry.clusterName}
                    </td>
                    <td className="wb-change-log-td">
                      <span className={`wb-change-log-badge ${getChangeToneClass(entry)}`}>
                        {formatChangeType(entry)}
                      </span>
                    </td>
                    <td className="wb-change-log-td wb-change-log-td--value">
                      {formatChangeValue(entry)}
                    </td>
                    <td className="wb-change-log-td wb-change-log-td--center">
                      {formatPosition(entry.position)}
                    </td>
                    <td className="wb-change-log-td wb-change-log-td--center">
                      {bidReasonLabel(entry.reason) ? (
                        <span className={reasonToneClass(entry.reason)}>
                          {bidReasonLabel(entry.reason)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="wb-change-log-td wb-change-log-td--center">
                      {formatInitiator(entry)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
