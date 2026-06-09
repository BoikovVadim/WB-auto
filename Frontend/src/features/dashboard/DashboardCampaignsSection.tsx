import React, { useCallback, useState } from "react";

import {
  fetchRawCampaigns,
  fetchRawCampaignProducts,
  type RawCampaignRow,
  type RawCampaignProductRow,
} from "../../api/syncClientCore";
import { type ColumnDef } from "./RawTableSection";
import { mutedStyle, tdStyle, thStyle } from "./RawTableSection.styles";
import { cacheRawSection, getCachedRawSection } from "../../api/rawSectionCache";
import { useVirtualRows } from "./useVirtualRows";

const TABBED_ROW_H = 34;
const TABBED_DEFAULT_COL_WIDTH = 100;

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
            cacheKey="raw-campaigns"
            columns={campaignCols}
            getRowKey={(r) => String(r.advertId)}
            filterRow={(r, q) => (r.name ?? "").toLowerCase().includes(q) || String(r.advertId).includes(q)}
          />
        ) : (
          <TabbedInnerTable
            fetchData={fetchProducts}
            cacheKey="raw-campaign-products"
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
  cacheKey,
  columns,
  getRowKey,
  filterRow,
}: {
  fetchData: () => Promise<T[]>;
  /** Кэш-ключ: первый кадр из rawSectionCache мгновенно, ревалидация в фоне без скелетона. */
  cacheKey?: string;
  columns: ColumnDef<T>[];
  getRowKey: (row: T) => string;
  filterRow?: (row: T, search: string) => boolean;
}) {
  const cachedRows = cacheKey ? getCachedRawSection<T>(cacheKey) : null;
  const [rows, setRows] = useState<T[]>(cachedRows ?? []);
  const [isLoading, setIsLoading] = useState(cachedRows == null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const hasRows = (cacheKey ? getCachedRawSection<T>(cacheKey) : null) != null;
    if (!hasRows) {
      setIsLoading(true);
    }
    setError(null);
    fetchData()
      .then((data) => {
        setRows(data);
        if (cacheKey) {
          cacheRawSection(cacheKey, data);
        }
      })
      .catch((err: unknown) => {
        if (!hasRows) {
          setError(err instanceof Error ? err.message : "Ошибка");
        }
      })
      .finally(() => setIsLoading(false));
  }, [fetchData, cacheKey]);

  const filtered = filterRow && search
    ? rows.filter((r) => filterRow(r, search.toLowerCase()))
    : rows;

  // Виртуализация строк (общий хук) — в DOM только видимое окно; bounded-скролл и sticky-шапку
  // даёт глобальный CSS (.wb-table-wrap + .wb-data-table), как у RawTableSection.
  const { scrollRef, items, paddingTop, paddingBottom } = useVirtualRows(
    filtered.length,
    TABBED_ROW_H,
    search,
  );
  const totalColWidth = columns.reduce(
    (sum, c) => sum + (typeof c.width === "number" ? c.width : TABBED_DEFAULT_COL_WIDTH),
    0,
  );

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
        <>
          <div ref={scrollRef} className="wb-table-wrap">
            <table
              className="wb-data-table"
              style={{ width: "100%", minWidth: totalColWidth, tableLayout: "fixed" }}
            >
              <colgroup>
                {columns.map((c) => (
                  <col key={c.key} style={{ width: c.width ?? TABBED_DEFAULT_COL_WIDTH }} />
                ))}
              </colgroup>
              <thead>
                <tr>{columns.map((c) => <th key={c.key} style={thStyle}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {paddingTop > 0 && (
                  <tr aria-hidden style={{ height: paddingTop }}>
                    <td colSpan={columns.length} style={{ padding: 0, border: "none" }} />
                  </tr>
                )}
                {items.map((vi) => {
                  const row = filtered[vi.index];
                  if (!row) return null;
                  return (
                    <tr key={getRowKey(row)} style={{ height: TABBED_ROW_H }}>
                      {columns.map((c) => <td key={c.key} style={tdStyle}>{c.render(row)}</td>)}
                    </tr>
                  );
                })}
                {paddingBottom > 0 && (
                  <tr aria-hidden style={{ height: paddingBottom }}>
                    <td colSpan={columns.length} style={{ padding: 0, border: "none" }} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p style={{ ...mutedStyle, fontSize: 11, padding: "8px 0 0" }}>
            Показано {filtered.length} из {rows.length} строк
          </p>
        </>
      )}
    </div>
  );
}
