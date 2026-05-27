import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchJamDailyMatrix, type JamDailyRow } from "../../api/syncClientJam";
import type { ProductListItem } from "./useDashboardProductsWorkspace";

type Props = {
  products: ProductListItem[];
  onBack: () => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Metric selector
// ─────────────────────────────────────────────────────────────────────────────

type Metric = "avgPosition" | "bestPosition" | "totalFrequency" | "totalClicks" | "totalAddToCart" | "totalOrders" | "queryCount";

const METRICS: { key: Metric; label: string; description: string }[] = [
  { key: "avgPosition",    label: "Ср. позиция",  description: "Средняя позиция по всем поисковым фразам" },
  { key: "bestPosition",   label: "Лучш. позиция", description: "Лучшая позиция из всех фраз" },
  { key: "totalFrequency", label: "Частотность",  description: "Суммарная частотность всех фраз" },
  { key: "totalClicks",    label: "Клики",        description: "Сумма кликов по карточке (openCard)" },
  { key: "totalAddToCart", label: "В корзину",    description: "Сумма добавлений в корзину" },
  { key: "totalOrders",    label: "Заказы JAM",   description: "Сумма заказов по данным JAM" },
  { key: "queryCount",     label: "Кол-во фраз",  description: "Количество поисковых фраз" },
];

function formatMetricValue(key: Metric, value: number | null): string {
  if (value == null) return "—";
  if (key === "avgPosition" || key === "bestPosition") {
    return value.toFixed(1);
  }
  return value.toLocaleString("ru-RU");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day ?? ""}.${month ?? ""}.${year ?? ""}`;
}

type JamMatrix = {
  dates: string[];
  products: { nmId: number; rows: Map<string, JamDailyRow> }[];
};

const JAM_MATRIX_CACHE_KEY = "wb_jam_matrix_v1";

function readMatrixCache(): JamMatrix | null {
  try {
    const raw = localStorage.getItem(JAM_MATRIX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { dates: string[]; products: { nmId: number; rows: [string, JamDailyRow][] }[] };
    return {
      dates: parsed.dates,
      products: parsed.products.map((p) => ({ nmId: p.nmId, rows: new Map(p.rows) })),
    };
  } catch {
    return null;
  }
}

function writeMatrixCache(m: JamMatrix) {
  try {
    const serializable = {
      dates: m.dates,
      products: m.products.map((p) => ({ nmId: p.nmId, rows: [...p.rows.entries()] })),
    };
    localStorage.setItem(JAM_MATRIX_CACHE_KEY, JSON.stringify(serializable));
  } catch { /* quota */ }
}

function buildMatrix(apiRows: JamDailyRow[]): JamMatrix {
  const datesSet = new Set<string>();
  for (const r of apiRows) datesSet.add(r.jamDate);
  const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1));

  const byNmId = new Map<number, Map<string, JamDailyRow>>();
  for (const r of apiRows) {
    if (!byNmId.has(r.nmId)) byNmId.set(r.nmId, new Map());
    byNmId.get(r.nmId)!.set(r.jamDate, r);
  }
  const products = Array.from(byNmId.entries()).map(([nmId, rows]) => ({ nmId, rows }));
  return { dates, products };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function DashboardJamDailySection({ products, onBack }: Props) {
  const tableRef = useRef<HTMLTableElement | null>(null);
  const resizingColRef = useRef<number | null>(null);

  const [matrix, setMatrix]     = useState<JamMatrix>(() => readMatrixCache() ?? { dates: [], products: [] });
  const [loading, setLoading]   = useState(false);
  const [metric, setMetric]     = useState<Metric>("avgPosition");

  useEffect(() => {
    setLoading(true);
    fetchJamDailyMatrix()
      .then((rows) => {
        const m = buildMatrix(rows);
        setMatrix(m);
        writeMatrixCache(m);
      })
      .catch(() => { /* keep cached */ })
      .finally(() => { setLoading(false); });
  }, []);

  const matrixByNmId = useMemo(
    () => new Map(matrix.products.map((p) => [p.nmId, p])),
    [matrix.products],
  );

  const minWidths = useMemo(() => {
    const m = new Map<number, number>([[0, 36], [1, 80], [2, 90]]);
    for (let i = 3; i < 3 + matrix.dates.length; i++) m.set(i, 80);
    return m;
  }, [matrix.dates.length]);

  const handleResizeMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!tableRef.current) return;
      const colIndex = Number((event.currentTarget as HTMLElement).dataset.colIdx ?? "-1");
      if (!Number.isFinite(colIndex) || colIndex < 0) return;
      const tableEl = tableRef.current;
      const cols = tableEl.querySelectorAll<HTMLTableColElement>("colgroup col");
      if (!cols[colIndex]) return;

      const measuredColWidths = Array.from(cols).map((col) => {
        const measured = col.getBoundingClientRect().width;
        if (measured > 0) return measured;
        const parsed = Number.parseFloat(col.style.width);
        return Number.isFinite(parsed) ? parsed : 0;
      });
      const initialSelectedWidth = measuredColWidths[colIndex] ?? 0;
      const startX = event.clientX;
      resizingColRef.current = colIndex;
      document.body.style.cursor = "col-resize";

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (resizingColRef.current === null || !tableRef.current) return;
        const minWidth = minWidths.get(resizingColRef.current) ?? 48;
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.max(minWidth, initialSelectedWidth + delta);
        const col = cols[resizingColRef.current];
        if (col) { col.style.width = `${newWidth}px`; col.style.minWidth = `${newWidth}px`; }
        const totalTableWidth = measuredColWidths.reduce(
          (sum, w, i) => sum + (i === resizingColRef.current ? newWidth : w),
          0,
        );
        tableEl.style.width = `${Math.ceil(totalTableWidth)}px`;
      };

      const onMouseUp = () => {
        resizingColRef.current = null;
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp, { once: true });
    },
    [minWidths],
  );

  const COL_NO   = 48;
  const COL_ID   = 110;
  const COL_NAME = 220;
  const COL_DATE = 110;

  const totalFixedW = COL_NO + COL_ID + COL_NAME + COL_DATE * matrix.dates.length;

  const currentMetric = METRICS.find((m) => m.key === metric) ?? METRICS[0]!;

  // Column averages for position metrics, sums for count metrics
  const dateTotals = useMemo(() => {
    const isAvg = metric === "avgPosition" || metric === "bestPosition";
    return matrix.dates.map((d) => {
      const values: number[] = [];
      for (const product of products) {
        if (product.nmId == null) continue;
        const matrixRow = matrixByNmId.get(product.nmId);
        const row = matrixRow?.rows.get(d);
        const v = row ? row[metric] : null;
        if (v != null) values.push(v);
      }
      if (values.length === 0) return null;
      if (isAvg) return values.reduce((a, b) => a + b, 0) / values.length;
      return values.reduce((a, b) => a + b, 0);
    });
  }, [metric, matrix.dates, products, matrixByNmId]);

  return (
    <section className="wb-card wb-card--wide">
      <div className="wb-workspace-header wb-workspace-header--products-detail">
        <h2>JAM — ретроспектива</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {loading && <span style={{ fontSize: 12, color: "var(--wb-text-muted)" }}>Обновление…</span>}
          <button className="wb-secondary-button" type="button" onClick={onBack}>
            ← Назад к товарам
          </button>
        </div>
      </div>

      {/* Metric selector */}
      <div style={{ display: "flex", gap: 6, padding: "8px 16px 4px", flexWrap: "wrap" }}>
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            title={m.description}
            onClick={() => { setMetric(m.key); }}
            style={{
              padding: "3px 10px",
              borderRadius: 4,
              border: "1px solid",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: metric === m.key ? 700 : 400,
              background: metric === m.key ? "var(--wb-gold-mid, #c9a227)" : "transparent",
              color: metric === m.key ? "#fff" : "var(--wb-text-muted, #888)",
              borderColor: metric === m.key ? "var(--wb-gold-mid, #c9a227)" : "rgba(0,0,0,0.15)",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="wb-products-page">
        <section className="wb-table-section">
          <div className="wb-table-wrap--catalog-restricted">
            {matrix.dates.length === 0 && !loading ? (
              <p className="wb-empty-copy" style={{ padding: "32px" }}>
                Нет данных JAM. Данные появятся после следующей ночной синхронизации (06:00 МСК).
              </p>
            ) : (
              <table
                ref={tableRef}
                className="wb-data-table wb-data-table--products"
                style={{ tableLayout: "fixed", width: `${String(totalFixedW)}px` }}
              >
                <colgroup>
                  <col style={{ width: `${String(COL_NO)}px` }} />
                  <col style={{ width: `${String(COL_ID)}px` }} />
                  <col style={{ width: `${String(COL_NAME)}px` }} />
                  {matrix.dates.map((d) => (
                    <col key={d} style={{ width: `${String(COL_DATE)}px` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ width: COL_NO, position: "sticky", left: 0, zIndex: 4, background: "#fbf7eb" }}>№</th>
                    <th style={{ width: COL_ID, position: "sticky", left: COL_NO, zIndex: 4, background: "#fbf7eb" }}>
                      ID товара
                      <div className="wb-col-resize-handle" data-col-idx="1" onMouseDown={handleResizeMouseDown} />
                    </th>
                    <th style={{ width: COL_NAME, position: "sticky", left: COL_NO + COL_ID, zIndex: 4, background: "#fbf7eb" }}>
                      Название товара
                      <div className="wb-col-resize-handle" data-col-idx="2" onMouseDown={handleResizeMouseDown} />
                    </th>
                    {matrix.dates.map((d, i) => (
                      <th
                        key={d}
                        className="wb-table-cell--numeric"
                        style={{ width: COL_DATE }}
                      >
                        <span>{formatDate(d)}</span>
                        <div
                          className="wb-col-resize-handle"
                          data-col-idx={String(3 + i)}
                          onMouseDown={handleResizeMouseDown}
                        />
                      </th>
                    ))}
                  </tr>
                  <tr className="wb-products-totals-row wb-thead-row--second">
                    <th style={{ position: "sticky", top: 26, left: 0, background: "var(--wb-table-totals-bg)", zIndex: 3 }} />
                    <th style={{ position: "sticky", top: 26, left: COL_NO, background: "var(--wb-table-totals-bg)", zIndex: 3 }} />
                    <th
                      style={{
                        position: "sticky", top: 26, left: COL_NO + COL_ID,
                        background: "var(--wb-table-totals-bg)", zIndex: 3,
                        textAlign: "left", fontSize: "11px", fontWeight: 700, color: "rgba(15,23,42,0.45)",
                      }}
                    >
                      {metric === "avgPosition" || metric === "bestPosition" ? "Среднее" : "Итого"}
                    </th>
                    {matrix.dates.map((d, i) => {
                      const total = dateTotals[i];
                      return (
                        <th key={d} className="wb-table-cell--numeric"
                          style={{ position: "sticky", top: 26, background: "var(--wb-table-totals-bg)", zIndex: 3 }}
                        >
                          {total != null ? formatMetricValue(metric, total) : "—"}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {products.map((product, index) => {
                    const matrixRow = product.nmId != null ? matrixByNmId.get(product.nmId) : undefined;
                    const displayName =
                      product.vendorCode !== ""
                        ? product.vendorCode
                        : product.nmId != null
                          ? `#${String(product.nmId)}`
                          : "—";

                    return (
                      <tr key={`${product.vendorCode}-${product.nmId ?? "none"}`}>
                        <td className="wb-table-cell--numeric" style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>
                          {String(index + 1)}
                        </td>
                        <td className="wb-table-cell--numeric" style={{ position: "sticky", left: COL_NO, background: "#fff", zIndex: 1 }}>
                          {product.nmId != null ? String(product.nmId) : "—"}
                        </td>
                        <td style={{ position: "sticky", left: COL_NO + COL_ID, background: "#fff", zIndex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {displayName}
                        </td>
                        {matrix.dates.map((d) => {
                          const row = matrixRow?.rows.get(d);
                          const value = row ? row[metric] : null;
                          return (
                            <td key={d} className="wb-table-cell--numeric">
                              {formatMetricValue(metric, value ?? null)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
