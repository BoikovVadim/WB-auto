import { useCallback } from "react";

import { fetchRawQueryFrequencies, type RawQueryFrequencyRow } from "../../api/syncClientCore";
import { RawTableSection, type ColumnDef, mutedStyle } from "./RawTableSection";

const columns: ColumnDef<RawQueryFrequencyRow>[] = [
  { key: "queryText", label: "Поисковая фраза", width: 300, render: (r) => r.queryText },
  { key: "monthlyFrequency", label: "Частота / мес.", width: 120, render: (r) => r.monthlyFrequency != null ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{r.monthlyFrequency.toLocaleString("ru")}</span> : <span style={mutedStyle}>—</span> },
  { key: "reportType", label: "Тип отчёта", width: 110, render: (r) => r.reportType ?? <span style={mutedStyle}>—</span> },
  { key: "reportStartDate", label: "Период с", width: 100, render: (r) => r.reportStartDate ? <span style={mutedStyle}>{r.reportStartDate}</span> : <span style={mutedStyle}>—</span> },
  { key: "reportEndDate", label: "Период по", width: 100, render: (r) => r.reportEndDate ? <span style={mutedStyle}>{r.reportEndDate}</span> : <span style={mutedStyle}>—</span> },
  { key: "syncedAt", label: "Синхронизировано", width: 145, render: (r) => r.syncedAt ? <span style={mutedStyle}>{r.syncedAt.slice(0, 16).replace("T", " ")}</span> : <span style={mutedStyle}>—</span> },
];

export function DashboardQueryFrequenciesSection({ onBack }: { onBack: () => void }) {
  const fetchData = useCallback(() => fetchRawQueryFrequencies(2000), []);

  return (
    <RawTableSection
      title="Частоты поисковых запросов"
      subtitle="{count} фраз · wb_search_query_frequencies"
      onBack={onBack}
      fetchData={fetchData}
      columns={columns}
      getRowKey={(r) => r.normalizedQueryText}
      filterRow={(r, q) => r.queryText.toLowerCase().includes(q)}
    />
  );
}
