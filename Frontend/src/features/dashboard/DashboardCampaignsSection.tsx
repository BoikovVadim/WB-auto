import React, { useCallback, useState } from "react";

import {
  fetchRawCampaigns,
  fetchRawCampaignProducts,
  type RawCampaignRow,
  type RawCampaignProductRow,
} from "../../api/syncClientCore";
import { type ColumnDef } from "./RawTableSection";
import { mutedStyle } from "./RawTableSection.styles";

type CampaignsTab = "campaigns" | "products";

const CAMPAIGN_STATUS: Record<number, string> = {
  4: "Готова к запуску", 7: "Завершена", 8: "Отказано",
  9: "Идут показы", 11: "Пауза",
};

const CAMPAIGN_TYPE: Record<number, string> = {
  4: "Каталог", 5: "Карточка", 6: "Поиск",
  7: "Рекомендации", 8: "Авто", 9: "Поиск+Каталог",
};

function StatusBadge({ status }: { status: number | null }) {
  if (status == null) return <span style={mutedStyle}>—</span>;
  const label = CAMPAIGN_STATUS[status] ?? String(status);
  const isActive = status === 9;
  return (
    <span className="wb-chip" style={{
      background: isActive ? "rgba(76,175,80,0.2)" : "rgba(255,255,255,0.06)",
      color: isActive ? "#4caf50" : "var(--color-text-muted, #888)",
      fontSize: 10, padding: "2px 7px",
    }}>
      {label}
    </span>
  );
}

const campaignCols: ColumnDef<RawCampaignRow>[] = [
  { key: "advertId", label: "ID", width: 90, render: (r) => <span style={{ fontFamily: "monospace" }}>{r.advertId}</span> },
  { key: "name", label: "Название", width: 240, render: (r) => r.name ?? <span style={mutedStyle}>—</span> },
  { key: "status", label: "Статус", width: 140, render: (r) => <StatusBadge status={r.campaignStatus} /> },
  { key: "type", label: "Тип", width: 130, render: (r) => r.campaignType != null ? (CAMPAIGN_TYPE[r.campaignType] ?? String(r.campaignType)) : <span style={mutedStyle}>—</span> },
  { key: "paymentType", label: "Оплата", width: 80, render: (r) => r.paymentType ?? <span style={mutedStyle}>—</span> },
  { key: "currency", label: "Валюта", width: 70, render: (r) => r.currency ?? <span style={mutedStyle}>—</span> },
  { key: "startedAtWb", label: "Запущена", width: 145, render: (r) => r.startedAtWb ? <span style={mutedStyle}>{r.startedAtWb.slice(0, 16).replace("T", " ")}</span> : <span style={mutedStyle}>—</span> },
  { key: "syncedAt", label: "Синхронизировано", width: 145, render: (r) => r.syncedAt ? <span style={mutedStyle}>{r.syncedAt.slice(0, 16).replace("T", " ")}</span> : <span style={mutedStyle}>—</span> },
];

const productCols: ColumnDef<RawCampaignProductRow>[] = [
  { key: "advertId", label: "ID кампании", width: 100, render: (r) => <span style={{ fontFamily: "monospace" }}>{r.advertId}</span> },
  { key: "nmId", label: "nmId", width: 80, render: (r) => <span style={{ fontFamily: "monospace" }}>{r.nmId}</span> },
  { key: "campaignName", label: "Кампания", width: 200, render: (r) => r.campaignName ?? <span style={mutedStyle}>—</span> },
  { key: "status", label: "Статус РК", width: 140, render: (r) => <StatusBadge status={r.campaignStatus} /> },
  { key: "subjectName", label: "Предмет", width: 140, render: (r) => r.subjectName ?? <span style={mutedStyle}>—</span> },
  { key: "searchBid", label: "Ставка", width: 80, render: (r) => r.searchBid != null ? String(r.searchBid) : <span style={mutedStyle}>—</span> },
  { key: "minSearchBid", label: "Мин. ставка", width: 100, render: (r) => r.minSearchBid != null ? String(r.minSearchBid) : <span style={mutedStyle}>—</span> },
  { key: "syncedAt", label: "Синхронизировано", width: 145, render: (r) => r.syncedAt ? <span style={mutedStyle}>{r.syncedAt.slice(0, 16).replace("T", " ")}</span> : <span style={mutedStyle}>—</span> },
];

function Tabs({ active, onChange }: { active: CampaignsTab; onChange: (t: CampaignsTab) => void }) {
  const base: React.CSSProperties = { padding: "6px 16px", fontSize: 13, border: "none", borderRadius: 6, cursor: "pointer", transition: "all 0.15s" };
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--color-border, #2a2a3a)", paddingBottom: 8 }}>
      {(["campaigns", "products"] as CampaignsTab[]).map((t) => (
        <button key={t} style={{
          ...base,
          fontWeight: active === t ? 600 : 400,
          color: active === t ? "var(--color-text, #fff)" : "var(--color-text-muted, #888)",
          background: active === t ? "rgba(99,102,241,0.15)" : "transparent",
        }} onClick={() => onChange(t)}>
          {t === "campaigns" ? "Кампании" : "Товары в РК"}
        </button>
      ))}
    </div>
  );
}

export function DashboardCampaignsSection({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<CampaignsTab>("campaigns");

  const fetchCampaigns = useCallback(() => fetchRawCampaigns(500), []);
  const fetchProducts = useCallback(() => fetchRawCampaignProducts({ limit: 1000 }), []);

  return (
    <div className="wb-exports-scroll">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="wb-secondary-button" onClick={onBack}>← Назад к выгрузкам</button>
      </div>

      <section className="wb-card" style={{ padding: "clamp(12px, 1vw, 16px)" }}>
        <div className="wb-card-header" style={{ marginBottom: 4 }}>
          <div>
            <h2>Рекламные кампании</h2>
            <p className="wb-card-meta">Сырые данные wb_campaigns и wb_campaign_products из БД</p>
          </div>
        </div>

        <Tabs active={tab} onChange={setTab} />

        {tab === "campaigns" ? (
          <TabbedInnerTable
            fetchData={fetchCampaigns}
            columns={campaignCols}
            getRowKey={(r) => String(r.advertId)}
            filterRow={(r, q) => (r.name ?? "").toLowerCase().includes(q) || String(r.advertId).includes(q)}
          />
        ) : (
          <TabbedInnerTable
            fetchData={fetchProducts}
            columns={productCols}
            getRowKey={(r) => `${r.advertId}-${r.nmId}`}
            filterRow={(r, q) => String(r.nmId).includes(q) || String(r.advertId).includes(q) || (r.campaignName ?? "").toLowerCase().includes(q)}
          />
        )}
      </section>
    </div>
  );
}

// Shared inner-table renderer (no back button / outer card — for use inside tabbed sections)
import { useEffect } from "react";

export function TabbedInnerTable<T>({
  fetchData,
  columns,
  getRowKey,
  filterRow,
}: {
  fetchData: () => Promise<T[]>;
  columns: ColumnDef<T>[];
  getRowKey: (row: T) => string;
  filterRow?: (row: T, search: string) => boolean;
}) {
  const [rows, setRows] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    fetchData()
      .then(setRows)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Ошибка"))
      .finally(() => setIsLoading(false));
  }, [fetchData]);

  const filtered = filterRow && search
    ? rows.filter((r) => filterRow(r, search.toLowerCase()))
    : rows;

  const thS: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--color-text-muted, #888)", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", borderBottom: "1px solid var(--color-border, #2a2a3a)" };
  const tdS: React.CSSProperties = { padding: "6px 10px", fontSize: 12, borderBottom: "1px solid rgba(255,255,255,0.04)", verticalAlign: "middle", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {filterRow && (
          <input className="wb-input" placeholder="Поиск..." value={search}
            onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
        )}
        <span style={{ ...mutedStyle, fontSize: 12, alignSelf: "center" }}>
          {isLoading ? "Загружаем..." : `${filtered.length} из ${rows.length} строк`}
        </span>
      </div>
      {error && <p style={{ color: "var(--color-danger, #f87171)" }}>{error}</p>}
      {!isLoading && filtered.length === 0 && !error && (
        <p style={{ ...mutedStyle, padding: "24px 0" }}>Данных нет</p>
      )}
      {filtered.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="wb-data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{columns.map((c) => <th key={c.key} style={{ ...thS, width: c.width }}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={getRowKey(row)}>
                  {columns.map((c) => <td key={c.key} style={tdS}>{c.render(row)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ ...mutedStyle, fontSize: 11, padding: "8px 0 0" }}>
            Показано {filtered.length} из {rows.length} строк
          </p>
        </div>
      )}
    </div>
  );
}
