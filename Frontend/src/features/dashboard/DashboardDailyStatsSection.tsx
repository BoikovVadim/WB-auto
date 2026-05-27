import { useCallback } from "react";

import { fetchRawDailyStats, type RawDailyStatRow } from "../../api/syncClientCore";
import { RawTableSection, type ColumnDef } from "./RawTableSection";
import { mutedStyle } from "./RawTableSection.styles";

function num(v: number | null, d = 0) {
  if (v == null) return <span style={mutedStyle}>—</span>;
  return d > 0 ? v.toFixed(d) : String(v);
}

const columns: ColumnDef<RawDailyStatRow>[] = [
  { key: "statDate", label: "Дата", width: 100, render: (r) => <span style={{ fontFamily: "monospace" }}>{r.statDate}</span> },
  { key: "advertId", label: "ID кампании", width: 100, render: (r) => <span style={{ fontFamily: "monospace" }}>{r.advertId}</span> },
  { key: "nmId", label: "nmId", width: 80, render: (r) => <span style={{ fontFamily: "monospace" }}>{r.nmId}</span> },
  { key: "clusterName", label: "Кластер", width: 200, render: (r) => r.clusterName ?? <span style={mutedStyle}>—</span> },
  { key: "views", label: "Показы", width: 80, render: (r) => num(r.views) },
  { key: "clicks", label: "Клики", width: 70, render: (r) => num(r.clicks) },
  { key: "orders", label: "Заказы", width: 70, render: (r) => num(r.orders) },
  { key: "addToCart", label: "В корзину", width: 85, render: (r) => num(r.addToCart) },
  { key: "shks", label: "ШК", width: 60, render: (r) => num(r.shks) },
  { key: "ctr", label: "CTR", width: 65, render: (r) => num(r.ctr, 2) },
  { key: "avgPosition", label: "Позиция", width: 80, render: (r) => num(r.avgPosition, 1) },
  { key: "cpc", label: "CPC", width: 65, render: (r) => num(r.cpc, 2) },
  { key: "cpm", label: "CPM", width: 65, render: (r) => num(r.cpm, 2) },
  { key: "spend", label: "Расход", width: 80, render: (r) => num(r.spend) },
  { key: "currency", label: "Валюта", width: 70, render: (r) => r.currency ?? <span style={mutedStyle}>—</span> },
  { key: "syncedAt", label: "Синхронизировано", width: 145, render: (r) => r.syncedAt ? <span style={mutedStyle}>{r.syncedAt.slice(0, 16).replace("T", " ")}</span> : <span style={mutedStyle}>—</span> },
];

export function DashboardDailyStatsSection({ onBack }: { onBack: () => void }) {
  const fetchData = useCallback(() => fetchRawDailyStats({ limit: 2000 }), []);

  return (
    <RawTableSection
      title="Дневная статистика кластеров"
      subtitle="{count} строк · wb_cluster_daily_stats"
      onBack={onBack}
      fetchData={fetchData}
      columns={columns}
      getRowKey={(r) => r.dailyStatKey}
      filterRow={(r, q) =>
        r.statDate.includes(q) ||
        String(r.nmId).includes(q) ||
        String(r.advertId).includes(q) ||
        (r.clusterName ?? "").toLowerCase().includes(q)
      }
    />
  );
}
