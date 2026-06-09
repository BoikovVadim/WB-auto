import { useCallback } from "react";

import { fetchRawClusterStats, type RawClusterStatRow } from "../../api/syncClientCore";
import { RawTableSection, type ColumnDef } from "./RawTableSection";
import { mutedStyle } from "./RawTableSection.styles";

function num(v: number | null, d = 0) {
  if (v == null) return <span style={mutedStyle}>—</span>;
  return d > 0 ? v.toFixed(d) : String(v);
}

const columns: ColumnDef<RawClusterStatRow>[] = [
  { key: "advertId", label: "ID кампании", width: 100, render: (r) => <span style={{ fontFamily: "monospace" }}>{r.advertId}</span> },
  { key: "nmId", label: "nmId", width: 80, render: (r) => <span style={{ fontFamily: "monospace" }}>{r.nmId}</span> },
  { key: "clusterName", label: "Кластер", width: 200, render: (r) => r.clusterName ?? <span style={mutedStyle}>—</span> },
  { key: "sourceKind", label: "Источник", width: 100, render: (r) => r.sourceKind ?? <span style={mutedStyle}>—</span> },
  { key: "isActive", label: "Активен", width: 80, render: (r) => r.isActive != null ? (r.isActive ? <span style={{ color: "#4caf50", fontSize: 12 }}>✓</span> : <span style={mutedStyle}>—</span>) : <span style={mutedStyle}>—</span> },
  { key: "views", label: "Показы", width: 80, render: (r) => num(r.views) },
  { key: "clicks", label: "Клики", width: 70, render: (r) => num(r.clicks) },
  { key: "orders", label: "Заказы", width: 70, render: (r) => num(r.orders) },
  { key: "ctr", label: "CTR", width: 70, render: (r) => num(r.ctr, 2) },
  { key: "avgPosition", label: "Позиция", width: 80, render: (r) => num(r.avgPosition, 1) },
  { key: "spend", label: "Расход", width: 80, render: (r) => num(r.spend) },
  { key: "currency", label: "Валюта", width: 70, render: (r) => r.currency ?? <span style={mutedStyle}>—</span> },
  { key: "syncedAt", label: "Синхронизировано", width: 145, render: (r) => r.syncedAt ? <span style={mutedStyle}>{r.syncedAt.slice(0, 16).replace("T", " ")}</span> : <span style={mutedStyle}>—</span> },
];

export function DashboardClusterStatsSection({ onBack }: { onBack: () => void }) {
  const fetchData = useCallback(() => fetchRawClusterStats({ limit: 1000 }), []);

  return (
    <RawTableSection
      title="Кластеры рекламы"
      subtitle="{count} кластеров · wb_clusters + wb_cluster_stats"
      onBack={onBack}
      fetchData={fetchData}
      cacheKey="cluster-stats"
      columns={columns}
      getRowKey={(r) => r.clusterKey}
      filterRow={(r, q) =>
        (r.clusterName ?? "").toLowerCase().includes(q) ||
        String(r.nmId).includes(q) ||
        String(r.advertId).includes(q)
      }
    />
  );
}
