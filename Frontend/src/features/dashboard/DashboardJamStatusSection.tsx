import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchJamBackfillQueue,
  fetchRawJamRows,
  type JamBackfillQueueItem,
  type RawJamRow,
} from "../../api/syncClientCore";
import { ProductAdvertisingDateFilter } from "./advertising/ProductAdvertisingDateFilter";
import {
  formatCalendarDateValue,
  type AdvertisingDateRange,
} from "./advertising/date";
import { mutedStyle, tdStyle, thStyle } from "./RawTableSection.styles";

type JamTab = "data" | "progress";

// ── helpers ────────────────────────────────────────────────────────────────

function ProgressBar({ filled, total }: { filled: number; total: number }) {
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 120 }}>
      <div
        style={{
          flex: 1, height: 8,
          background: "var(--color-surface-alt, #2a2a3a)",
          borderRadius: 4, overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`, height: "100%",
            background: pct === 100 ? "var(--color-success, #4caf50)" : "var(--color-primary, #6366f1)",
            borderRadius: 4, transition: "width 0.3s ease",
          }}
        />
      </div>
      <span style={{ fontSize: 11, ...mutedStyle, minWidth: 32, textAlign: "right" }}>
        {pct}%
      </span>
    </div>
  );
}

function GroupBadge({ group }: { group: "active_rk" | "no_rk" }) {
  return (
    <span
      className="wb-chip"
      style={{
        background: group === "active_rk" ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.06)",
        color: group === "active_rk" ? "#a5b4fc" : "var(--color-text-muted, #888)",
        fontSize: 10, padding: "2px 7px",
      }}
    >
      {group === "active_rk" ? "Активная РК" : "Без РК"}
    </span>
  );
}

function TabBar({ active, onChange }: { active: JamTab; onChange: (t: JamTab) => void }) {
  const tabStyle = (t: JamTab): React.CSSProperties => ({
    padding: "6px 16px",
    fontSize: 13,
    fontWeight: active === t ? 600 : 400,
    color: active === t ? "var(--color-text, #fff)" : "var(--color-text-muted, #888)",
    background: active === t ? "rgba(99,102,241,0.15)" : "transparent",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    transition: "all 0.15s",
  });
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--color-border, #2a2a3a)", paddingBottom: 8 }}>
      <button style={tabStyle("data")} onClick={() => onChange("data")}>
        Данные ВБ
      </button>
      <button style={tabStyle("progress")} onClick={() => onChange("progress")}>
        Прогресс
      </button>
    </div>
  );
}

// ── JAM raw data tab ────────────────────────────────────────────────────────

function fmt(v: number | null, decimals = 0) {
  if (v == null) return <span style={mutedStyle}>—</span>;
  return decimals > 0 ? v.toFixed(decimals) : String(v);
}

function Delta({ v }: { v: number | null }) {
  if (v == null) return <span style={mutedStyle}>—</span>;
  const color = v > 0 ? "#4caf50" : v < 0 ? "#f87171" : "var(--color-text-muted, #888)";
  return <span style={{ color, fontSize: 11 }}>{v > 0 ? `+${v}` : String(v)}</span>;
}

function JamDataTab() {
  const [rows, setRows] = useState<RawJamRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [nmIdFilter, setNmIdFilter] = useState("");
  const [dateRange, setDateRange] = useState<AdvertisingDateRange>({ start: null, end: null });

  // nmId is valid only when the field contains a non-empty pure-integer string.
  const parsedNmId = useMemo(() => {
    const s = nmIdFilter.trim();
    if (!s || !/^\d+$/.test(s)) return undefined;
    return Number(s);
  }, [nmIdFilter]);

  const dateFrom = useMemo(
    () => (dateRange.start ? formatCalendarDateValue(dateRange.start) : undefined),
    [dateRange.start],
  );
  const dateTo = useMemo(
    () => (dateRange.end ? formatCalendarDateValue(dateRange.end) : undefined),
    [dateRange.end],
  );

  // Mutable ref so the stable `load` function always reads the latest query params
  // without needing them in its dependency array (which would re-fire on every keystroke).
  const queryRef = useRef({ parsedNmId, dateFrom, dateTo });
  // Keep the ref current after every render (assignment in render body is not allowed by lint).
  useEffect(() => {
    queryRef.current = { parsedNmId, dateFrom, dateTo };
  });

  // Ref to the in-flight AbortController so we can cancel stale requests.
  const abortRef = useRef<AbortController | null>(null);

  // Stable load — never re-created, always cancels the previous request first.
  const load = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const { parsedNmId: nmId, dateFrom: from, dateTo: to } = queryRef.current;

    setIsLoading(true);
    setError(null);
    // When nmId is provided the backend returns ALL rows for that product (no cap).
    // Without nmId the backend caps at 2000 rows to avoid overloading the browser.
    fetchRawJamRows({ nmId, dateFrom: from, dateTo: to, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setRows(data); })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return; // cancelled — ignore
        setError(err instanceof Error ? err.message : "Ошибка загрузки");
      })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
  }, []); // empty deps — stable; reads latest values via queryRef

  // Fire once on mount; cancel on unmount.
  useEffect(() => {
    load();
    return () => { abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-reload when the date range end changes (user finished selecting or cleared the range).
  // dateFrom-only changes (user picked start, hasn't picked end yet) do NOT trigger.
  const prevDateToRef = useRef(dateTo);
  useEffect(() => {
    if (prevDateToRef.current === dateTo) return;
    prevDateToRef.current = dateTo;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateTo]);

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.queryText.toLowerCase().includes(q) ||
      String(r.nmId).includes(q) ||
      r.startDate.includes(q)
    );
  });

  const nmIdInvalid = nmIdFilter.trim() !== "" && !/^\d+$/.test(nmIdFilter.trim());

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="wb-input"
          placeholder="Поиск по фразе..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 200 }}
        />
        <input
          className="wb-input"
          placeholder="nmId товара"
          value={nmIdFilter}
          onChange={(e) => setNmIdFilter(e.target.value)}
          style={{ width: 120, borderColor: nmIdInvalid ? "var(--color-danger, #f87171)" : undefined }}
          onBlur={() => { if (!nmIdInvalid) load(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !nmIdInvalid) load(); }}
        />
        {nmIdInvalid && (
          <span style={{ color: "var(--color-danger, #f87171)", fontSize: 12 }}>
            nmId — только цифры
          </span>
        )}
        {/* Date range picker reused from advertising section; allowAllPast → no minimum cutoff */}
        <ProductAdvertisingDateFilter
          dateRange={dateRange}
          bounds={null}
          allowAllPast
          onDateRangeChange={setDateRange}
        />
        <button className="wb-secondary-button" onClick={load} style={{ flexShrink: 0 }}>
          Загрузить
        </button>
        <span style={{ ...mutedStyle, fontSize: 12 }}>
          {isLoading
            ? "Загружаем..."
            : parsedNmId != null
              ? `${filtered.length} из ${rows.length} строк (все данные товара)`
              : `${filtered.length} из ${rows.length} строк${rows.length >= 2000 ? " · показаны первые 2000 — введите nmId для полных данных товара" : ""}`}
        </span>
      </div>

      {error && <p style={{ color: "var(--color-danger, #f87171)" }}>{error}</p>}

      {!isLoading && filtered.length === 0 && !error && (
        <p style={{ ...mutedStyle, padding: "24px 0" }}>Данных нет. Введите nmId и нажмите «Загрузить».</p>
      )}

      {filtered.length > 0 && (
        <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 320px)" }}>
          <table className="wb-data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {[
                  ["nmId", 70], ["Дата", 90], ["Поисковая фраза", 240],
                  ["Частота", 75], ["Нед. частота", 90], ["Позиция", 70], ["Δ поз.", 60],
                  ["Заказы", 70], ["Δ зак.", 60], ["Открытий", 75], ["В корзину", 80],
                  ["Синхронизировано", 145],
                ].map(([label, width]) => (
                  <th key={String(label)} style={{ ...thStyle, width: Number(width) }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.snapshotKey}-${r.normalizedQueryText}-${i}`}>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }}>
                    {r.nmId}
                  </td>
                  <td style={{ ...tdStyle, ...mutedStyle, fontFamily: "monospace", fontSize: 11 }}>
                    {r.startDate}
                  </td>
                  <td
                    style={{ ...tdStyle, maxWidth: 240 }}
                    title={r.queryText}
                  >
                    {r.queryText}
                  </td>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{fmt(r.frequency)}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{fmt(r.weekFrequency)}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{fmt(r.avgPositionCurrent, 1)}</td>
                  <td style={tdStyle}><Delta v={r.avgPositionDynamics} /></td>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{fmt(r.ordersCurrent)}</td>
                  <td style={tdStyle}><Delta v={r.ordersDynamics} /></td>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{fmt(r.openCardCurrent)}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{fmt(r.addToCartCurrent)}</td>
                  <td style={{ ...tdStyle, ...mutedStyle, fontSize: 11 }}>
                    {r.syncedAt ? r.syncedAt.slice(0, 16).replace("T", " ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── JAM progress tab ────────────────────────────────────────────────────────

type SortKey = "position" | "daysFilled" | "daysEmpty";

function SortArrow({ col, sortKey, sortAsc }: { col: SortKey; sortKey: SortKey; sortAsc: boolean }) {
  if (sortKey !== col) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
  return <span style={{ marginLeft: 4 }}>{sortAsc ? "↑" : "↓"}</span>;
}

function JamProgressTab() {
  const [items, setItems] = useState<JamBackfillQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("position");
  const [sortAsc, setSortAsc] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setIsLoading(true);
    fetchJamBackfillQueue()
      .then(setItems)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Ошибка загрузки"))
      .finally(() => setIsLoading(false));
  }, []);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(key === "position"); }
  };

  const filtered = items.filter((item) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (item.vendorCode ?? "").toLowerCase().includes(q) ||
      (item.productName ?? "").toLowerCase().includes(q) ||
      String(item.nmId).includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    let diff = 0;
    if (sortKey === "position") diff = a.position - b.position;
    else if (sortKey === "daysFilled") diff = b.daysFilled - a.daysFilled;
    else diff = b.daysEmpty - a.daysEmpty;
    return sortAsc ? diff : -diff;
  });

  const totalFilled = items.reduce((s, x) => s + x.daysFilled, 0);
  const totalDays = items.reduce((s, x) => s + x.daysTotal, 0);
  const totalComplete = items.filter((x) => x.isComplete).length;
  const activeRk = items.filter((x) => x.group === "active_rk");
  const activeRkComplete = activeRk.filter((x) => x.isComplete).length;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="wb-input"
          placeholder="Поиск по артикулу..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 200 }}
        />
        <span style={{ ...mutedStyle, fontSize: 12 }}>
          {isLoading
            ? "Загружаем..."
            : `${items.length} товаров · ${totalComplete} готово · ${totalDays > 0 ? Math.round((totalFilled / totalDays) * 100) : 0}% · РК ${activeRkComplete}/${activeRk.length}`}
        </span>
      </div>

      {error && <p style={{ color: "var(--color-danger, #f87171)" }}>{error}</p>}

      {!isLoading && (
        <div style={{ overflowX: "auto" }}>
          <table className="wb-data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => toggleSort("position")}>
                  # <SortArrow col="position" sortKey={sortKey} sortAsc={sortAsc} />
                </th>
                <th style={thStyle}>Артикул</th>
                <th style={thStyle}>Название</th>
                <th style={thStyle}>Группа</th>
                <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => toggleSort("daysFilled")}>
                  Дней с данными <SortArrow col="daysFilled" sortKey={sortKey} sortAsc={sortAsc} />
                </th>
                <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => toggleSort("daysEmpty")}>
                  Дней пусто <SortArrow col="daysEmpty" sortKey={sortKey} sortAsc={sortAsc} />
                </th>
                <th style={thStyle}>Прогресс</th>
                <th style={thStyle}>Статус</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr
                  key={item.nmId}
                  style={{ background: item.isComplete ? "rgba(76,175,80,0.04)" : "transparent" }}
                >
                  <td style={{ ...tdStyle, ...mutedStyle, fontSize: 11 }}>{item.position}</td>
                  <td style={{ ...tdStyle, fontWeight: 600, fontFamily: "monospace" }}>
                    {item.vendorCode ?? <span style={mutedStyle}>{item.nmId}</span>}
                  </td>
                  <td style={{ ...tdStyle, ...mutedStyle }} title={item.productName ?? ""}>
                    {item.productName ?? "—"}
                  </td>
                  <td style={tdStyle}><GroupBadge group={item.group} /></td>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ color: item.daysFilled > 0 ? "var(--color-text, #fff)" : "var(--color-text-muted, #888)" }}>
                      {item.daysFilled}
                    </span>
                    <span style={mutedStyle}>/{item.daysTotal}</span>
                  </td>
                  <td style={{ ...tdStyle, ...mutedStyle, fontVariantNumeric: "tabular-nums" }}>
                    {item.daysEmpty > 0 ? item.daysEmpty : "—"}
                  </td>
                  <td style={{ ...tdStyle, minWidth: 150 }}>
                    <ProgressBar filled={item.daysFilled + item.daysEmpty} total={item.daysTotal} />
                  </td>
                  <td style={tdStyle}>
                    {item.isComplete ? (
                      <span style={{ color: "var(--color-success, #4caf50)", fontSize: 12 }}>✓ готово</span>
                    ) : item.daysFilled + item.daysEmpty > 0 ? (
                      <span style={{ ...mutedStyle, fontSize: 12 }}>в процессе</span>
                    ) : (
                      <span style={{ ...mutedStyle, fontSize: 12, opacity: 0.5 }}>ожидает</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── main component ──────────────────────────────────────────────────────────

export function DashboardJamStatusSection(props: { onBack?: () => void }) {
  const [tab, setTab] = useState<JamTab>("data");

  return (
    <div className="wb-exports-scroll">
      {props.onBack && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="wb-secondary-button" onClick={props.onBack}>
            ← Назад к выгрузкам
          </button>
        </div>
      )}

      <section className="wb-card" style={{ padding: "clamp(12px, 1vw, 16px)" }}>
        <div className="wb-card-header" style={{ marginBottom: 4 }}>
          <div>
            <h2>JAM — поисковые запросы</h2>
            <p className="wb-card-meta">
              Сырые данные от WB Analytics API по поисковым фразам товаров
            </p>
          </div>
        </div>

        <TabBar active={tab} onChange={setTab} />

        {tab === "data" ? <JamDataTab /> : <JamProgressTab />}
      </section>
    </div>
  );
}
