import { memo, useEffect, useState } from "react";

import { fetchUnifiedChangeLog, type UnifiedChangeLogEntry } from "../../api/syncClientChangeLog";
import { clusterStatusLabel } from "./changeLogLabels";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    // new Date(<плохая строка>) не бросает, а возвращает Invalid Date — иначе
    // ниже получится "NaN.NaN.NaN".
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

function entityTypeLabel(entityType: string): string {
  switch (entityType) {
    case "cost_price":     return "Себестоимость";
    case "cluster_bid":    return "Ставка кластера";
    case "cluster_status": return "Статус кластера";
    default:               return entityType;
  }
}

function changeTypeLabel(changeType: string): string {
  switch (changeType) {
    case "set":           return "Установлена";
    case "clear":         return "Очищена";
    case "bid_change":    return "Изменена ставка";
    case "status_change": return "Изменён статус";
    default:              return changeType;
  }
}

/** Значение для колонок «Было»/«Стало». У статуса кластера enum active/excluded → русское слово. */
function valueLabel(entityType: string, value: string | null): string | null {
  if (entityType === "cluster_status") return clusterStatusLabel(value);
  return value;
}

/** Кто инициировал изменение: вручную пользователь или движок автоматизации по CPO. */
function initiatorLabel(initiatedBy: "user" | "automation" | null): string {
  switch (initiatedBy) {
    case "user":       return "Пользователь";
    case "automation": return "Автоматизация";
    default:           return "—";
  }
}

type BadgeColor = "blue" | "red" | "green" | "orange" | "gray";

function entityTypeBadgeColor(entityType: string): BadgeColor {
  switch (entityType) {
    case "cost_price":     return "orange";
    case "cluster_bid":    return "blue";
    case "cluster_status": return "green";
    default:               return "gray";
  }
}

const BADGE_STYLES: Record<BadgeColor, { background: string; color: string }> = {
  blue:   { background: "#e3f2fd", color: "#1565c0" },
  red:    { background: "#fce4ec", color: "#c62828" },
  green:  { background: "#e8f5e9", color: "#2e7d32" },
  orange: { background: "rgba(232,197,71,0.15)", color: "#7a5c00" },
  gray:   { background: "#f5f5f5", color: "#555" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────────────────────

function ChangeRow({ entry }: { entry: UnifiedChangeLogEntry }) {
  const badgeColor = entityTypeBadgeColor(entry.entityType);
  const badgeStyle = BADGE_STYLES[badgeColor];

  return (
    <tr className="wb-change-history-row">
      <td className="wb-change-history-cell wb-change-history-cell--date">
        {formatDateTime(entry.createdAt)}
      </td>
      <td className="wb-change-history-cell">
        <span className="wb-change-history-badge" style={badgeStyle}>
          {entityTypeLabel(entry.entityType)}
        </span>
      </td>
      <td className="wb-change-history-cell wb-change-history-cell--label">
        {entry.entityLabel ?? (entry.nmId !== null ? `Товар #${String(entry.nmId)}` : "—")}
      </td>
      <td className="wb-change-history-cell wb-change-history-cell--num">
        {entry.advertId !== null ? String(entry.advertId) : <span className="wb-change-history-empty">—</span>}
      </td>
      <td className="wb-change-history-cell wb-change-history-cell--label">
        {entry.productName ?? (entry.nmId !== null ? `Товар #${String(entry.nmId)}` : "—")}
      </td>
      <td className="wb-change-history-cell">
        {changeTypeLabel(entry.changeType)}
      </td>
      <td className="wb-change-history-cell wb-change-history-cell--value">
        {entry.oldValue != null ? (
          <span className="wb-change-history-old">{valueLabel(entry.entityType, entry.oldValue)}</span>
        ) : (
          <span className="wb-change-history-empty">—</span>
        )}
      </td>
      <td className="wb-change-history-cell wb-change-history-cell--value">
        {entry.newValue != null ? (
          <span className="wb-change-history-new">{valueLabel(entry.entityType, entry.newValue)}</span>
        ) : (
          <span className="wb-change-history-empty">—</span>
        )}
      </td>
      <td className="wb-change-history-cell">
        {entry.initiatedBy !== null ? (
          <span
            className="wb-change-history-badge"
            style={entry.initiatedBy === "automation" ? BADGE_STYLES.blue : BADGE_STYLES.gray}
          >
            {initiatorLabel(entry.initiatedBy)}
          </span>
        ) : (
          <span className="wb-change-history-empty">—</span>
        )}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section
// ─────────────────────────────────────────────────────────────────────────────

export const DashboardChangeHistorySection = memo(function DashboardChangeHistorySection() {
  const [entries, setEntries] = useState<UnifiedChangeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchUnifiedChangeLog(500)
      .then(setEntries)
      .catch(() => { setError("Не удалось загрузить историю изменений"); })
      .finally(() => { setLoading(false); });
  }, []);

  return (
    <section className="wb-card wb-card--wide wb-change-history-section">
      <div className="wb-workspace-header wb-workspace-header--products-list">
        <h2>История изменений</h2>
        {loading && <span style={{ fontSize: 12, color: "var(--wb-text-muted)" }}>Загрузка…</span>}
      </div>

      <div className="wb-change-history-scroll">
        {error ? (
          <p className="wb-empty-copy" style={{ padding: 24 }}>{error}</p>
        ) : !loading && entries.length === 0 ? (
          <p className="wb-empty-copy" style={{ padding: 24 }}>
            История изменений пуста. Изменения будут появляться здесь после того, как вы измените себестоимость товаров или ставки кластеров.
          </p>
        ) : (
          <table className="wb-data-table wb-change-history-table">
            <thead>
              <tr>
                <th style={{ minWidth: 130 }}>Дата и время</th>
                <th style={{ minWidth: 130 }}>Тип</th>
                <th style={{ minWidth: 200 }}>Объект</th>
                <th style={{ minWidth: 110, textAlign: "center" }}>ID РК</th>
                <th style={{ minWidth: 200 }}>Товар</th>
                <th style={{ minWidth: 130 }}>Действие</th>
                <th style={{ minWidth: 100 }}>Было</th>
                <th style={{ minWidth: 100 }}>Стало</th>
                <th style={{ minWidth: 130 }}>Инициатор</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => <ChangeRow key={e.id} entry={e} />)}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
});
