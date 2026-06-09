import { useCallback } from "react";

import { fetchRawSyncRuns, type RawSyncRunRow } from "../../api/syncClientCore";
import { RawTableSection, type ColumnDef } from "./RawTableSection";
import { mutedStyle } from "./RawTableSection.styles";

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span style={mutedStyle}>—</span>;
  const colorMap: Record<string, string> = {
    succeeded: "#4caf50",
    failed: "#f87171",
    running: "#6366f1",
    queued: "#888",
  };
  return (
    <span className="wb-chip" style={{
      background: "rgba(255,255,255,0.06)",
      color: colorMap[status] ?? "var(--color-text-muted, #888)",
      fontSize: 10, padding: "2px 7px",
    }}>
      {status}
    </span>
  );
}

const columns: ColumnDef<RawSyncRunRow>[] = [
  { key: "id", label: "ID", width: 120, render: (r) => <span style={{ fontFamily: "monospace", fontSize: 10 }}>{r.id.slice(0, 14)}…</span> },
  { key: "trigger", label: "Триггер", width: 90, render: (r) => r.trigger ?? <span style={mutedStyle}>—</span> },
  { key: "status", label: "Статус", width: 110, render: (r) => <StatusBadge status={r.status} /> },
  { key: "startedAt", label: "Начало", width: 145, render: (r) => r.startedAt ? <span style={mutedStyle}>{r.startedAt.slice(0, 16).replace("T", " ")}</span> : <span style={mutedStyle}>—</span> },
  { key: "finishedAt", label: "Конец", width: 145, render: (r) => r.finishedAt ? <span style={mutedStyle}>{r.finishedAt.slice(0, 16).replace("T", " ")}</span> : <span style={mutedStyle}>—</span> },
  { key: "campaignsSynced", label: "РК синх.", width: 80, render: (r) => r.campaignsSynced != null ? String(r.campaignsSynced) : <span style={mutedStyle}>—</span> },
  { key: "productsSeen", label: "Товаров", width: 80, render: (r) => r.productsSeen != null ? String(r.productsSeen) : <span style={mutedStyle}>—</span> },
  { key: "clustersUpserted", label: "Кластеров", width: 90, render: (r) => r.clustersUpserted != null ? String(r.clustersUpserted) : <span style={mutedStyle}>—</span> },
  { key: "statsRows", label: "Строк стат.", width: 90, render: (r) => r.statsRowsUpserted != null ? String(r.statsRowsUpserted) : <span style={mutedStyle}>—</span> },
  { key: "warnings", label: "Предупр.", width: 80, render: (r) => r.warningCount != null && r.warningCount > 0 ? <span style={{ color: "#fbbf24" }}>{r.warningCount}</span> : <span style={mutedStyle}>0</span> },
  { key: "error", label: "Ошибка", width: 200, render: (r) => r.errorMessage ? <span style={{ color: "var(--color-danger, #f87171)", fontSize: 11 }}>{r.errorMessage}</span> : <span style={mutedStyle}>—</span> },
];

export function DashboardSyncRunsSection({ onBack }: { onBack: () => void }) {
  const fetchData = useCallback(() => fetchRawSyncRuns(100), []);

  return (
    <RawTableSection
      title="Прогоны синхронизации"
      subtitle="{count} записей · история синхронизаций с WB"
      onBack={onBack}
      fetchData={fetchData}
      cacheKey="sync-runs"
      columns={columns}
      getRowKey={(r) => r.id}
      filterRow={(r, q) => (r.trigger ?? "").includes(q) || (r.status ?? "").includes(q) || r.id.includes(q)}
    />
  );
}
