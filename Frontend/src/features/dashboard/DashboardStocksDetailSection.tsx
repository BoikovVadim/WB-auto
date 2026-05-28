import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchStocksMatrix, type StocksMatrixRow } from "../../api/syncClientStocks";
import type { ProductListItem } from "./useDashboardProductsWorkspace";

type Props = {
  products: ProductListItem[];
  /** Latest stock quantities — same data shown in the Products tab */
  stockCounts: Map<number, number>;
  onBack: () => void;
};

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day ?? ""}.${month ?? ""}.${year ?? ""}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type StocksMatrix = { dates: string[]; products: { nmId: number; values: (number | null)[] }[] };

const STOCKS_MATRIX_CACHE_KEY  = "wb_stocks_matrix_v1";
const STOCKS_MATRIX_CACHE_DATE = "wb_stocks_matrix_v1_date";

function readMatrixCache(): StocksMatrix | null {
  try {
    const savedDate = localStorage.getItem(STOCKS_MATRIX_CACHE_DATE);
    if (savedDate !== todayIso()) return null;
    const raw = localStorage.getItem(STOCKS_MATRIX_CACHE_KEY);
    return raw ? (JSON.parse(raw) as StocksMatrix) : null;
  } catch {
    return null;
  }
}

function writeMatrixCache(m: StocksMatrix) {
  try {
    localStorage.setItem(STOCKS_MATRIX_CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(STOCKS_MATRIX_CACHE_DATE, todayIso());
  } catch { /* quota */ }
}

function buildMatrix(rows: StocksMatrixRow[]): StocksMatrix {
  const datesSet = new Set<string>();
  for (const r of rows) datesSet.add(r.stockDate);
  const dates = Array.from(datesSet).sort((a, b) => (a < b ? 1 : -1));
  const byNmId = new Map<number, Map<string, number>>();
  for (const r of rows) {
    if (!byNmId.has(r.nmId)) byNmId.set(r.nmId, new Map());
    byNmId.get(r.nmId)!.set(r.stockDate, r.quantity);
  }
  const products = Array.from(byNmId.entries()).map(([nmId, dateMap]) => ({
    nmId,
    values: dates.map((d) => dateMap.get(d) ?? null),
  }));
  return { dates, products };
}

export function DashboardStocksDetailSection({ products, stockCounts, onBack }: Props) {
  const tableRef = useRef<HTMLTableElement | null>(null);
  const resizingColRef = useRef<number | null>(null);

  const today = todayIso();

  const [matrix, setMatrix] = useState<StocksMatrix>(() => readMatrixCache() ?? { dates: [], products: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchStocksMatrix()
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

  // Latest date is pinned first (like "today" in orders); historical dates follow
  const latestDate = matrix.dates[0] ?? null;
  const uniqueDates = useMemo(() => {
    const result: string[] = [];
    if (latestDate) result.push(latestDate);
    for (const d of matrix.dates) {
      if (d !== latestDate) result.push(d);
    }
    return result;
  }, [matrix.dates, latestDate]);

  const minWidths = useMemo(() => {
    const m = new Map<number, number>([[0, 36], [1, 80], [2, 90]]);
    for (let i = 3; i < 3 + uniqueDates.length; i++) m.set(i, 80);
    return m;
  }, [uniqueDates.length]);

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
  const COL_DATE = 130;

  const totalFixedW = COL_NO + COL_ID + COL_NAME + COL_DATE * uniqueDates.length;

  const dateTotals = useMemo(() => {
    return uniqueDates.map((d) => {
      const isLatest = d === latestDate;
      let total = 0;
      for (const product of products) {
        if (product.nmId === null) continue;
        if (isLatest) {
          total += stockCounts.get(product.nmId) ?? 0;
        } else {
          const matrixRow = matrixByNmId.get(product.nmId);
          const dateIdx = matrix.dates.indexOf(d);
          total += matrixRow && dateIdx >= 0 ? (matrixRow.values[dateIdx] ?? 0) : 0;
        }
      }
      return total;
    });
  }, [uniqueDates, latestDate, products, stockCounts, matrixByNmId, matrix.dates]);

  return (
    <section className="wb-card wb-card--wide">
      <div className="wb-workspace-header wb-workspace-header--products-detail">
        <h2>Остатки</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {loading && <span style={{ fontSize: 12, color: "var(--wb-text-muted)" }}>Обновление…</span>}
          <button className="wb-secondary-button" type="button" onClick={onBack}>
            ← Назад к товарам
          </button>
        </div>
      </div>

      <div className="wb-products-page">
        <section className="wb-table-section">
          <div className="wb-table-wrap--catalog-restricted">
            {products.length === 0 ? (
              <p className="wb-empty-copy" style={{ padding: "32px" }}>Нет товаров.</p>
            ) : uniqueDates.length === 0 && !loading ? (
              <p className="wb-empty-copy" style={{ padding: "32px" }}>
                Нет данных. Первый снапшот будет снят сегодня в 01:00 МСК.
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
                  {uniqueDates.map((d) => (
                    <col key={d} style={{ width: `${String(COL_DATE)}px` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ width: COL_NO, position: "sticky", left: 0, zIndex: 4, background: "#fbf7eb" }}>
                      №
                    </th>
                    <th style={{ width: COL_ID, position: "sticky", left: COL_NO, zIndex: 4, background: "#fbf7eb" }}>
                      ID товара
                      <div className="wb-col-resize-handle" data-col-idx="1" onMouseDown={handleResizeMouseDown} />
                    </th>
                    <th style={{ width: COL_NAME, position: "sticky", left: COL_NO + COL_ID, zIndex: 4, background: "#fbf7eb" }}>
                      Название товара
                      <div className="wb-col-resize-handle" data-col-idx="2" onMouseDown={handleResizeMouseDown} />
                    </th>

                    {uniqueDates.map((d, i) => {
                      const isLatest = d === latestDate;
                      const stickyLeft = isLatest ? COL_NO + COL_ID + COL_NAME : undefined;
                      return (
                        <th
                          key={d}
                          className="wb-table-cell--numeric"
                          style={{
                            width: COL_DATE,
                            zIndex: isLatest ? 4 : 2,
                            ...(isLatest
                              ? { position: "sticky", left: stickyLeft, background: "#fbf7eb", borderRight: "2px solid var(--wb-gold-mid)" }
                              : {}),
                          }}
                        >
                          <span style={isLatest ? { color: "var(--wb-gold-dark)", fontWeight: 800 } : {}}>
                            {formatDate(d)}
                          </span>
                          <div
                            className="wb-col-resize-handle"
                            data-col-idx={String(3 + i)}
                            onMouseDown={handleResizeMouseDown}
                          />
                        </th>
                      );
                    })}
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
                      Итого
                    </th>
                    {uniqueDates.map((d, i) => {
                      const isLatest = d === latestDate;
                      const total = dateTotals[i] ?? 0;
                      return (
                        <th
                          key={d}
                          className="wb-table-cell--numeric"
                          style={{
                            position: "sticky", top: 26,
                            background: "var(--wb-table-totals-bg)",
                            zIndex: isLatest ? 4 : 2,
                            ...(isLatest
                              ? { left: COL_NO + COL_ID + COL_NAME, borderRight: "2px solid var(--wb-gold-mid)" }
                              : {}),
                          }}
                        >
                          {total > 0 ? String(total) : "—"}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {products.map((product, index) => {
                    const matrixRow = product.nmId !== null ? matrixByNmId.get(product.nmId) : undefined;
                    const displayName =
                      product.vendorCode !== ""
                        ? product.vendorCode
                        : product.nmId !== null
                          ? `#${String(product.nmId)}`
                          : "—";

                    return (
                      <tr key={`${product.vendorCode}-${product.nmId ?? "none"}`}>
                        <td
                          className="wb-table-cell--numeric"
                          style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1 }}
                        >
                          {String(index + 1)}
                        </td>
                        <td
                          className="wb-table-cell--numeric"
                          style={{ position: "sticky", left: COL_NO, background: "#fff", zIndex: 1 }}
                        >
                          {product.nmId !== null ? String(product.nmId) : "—"}
                        </td>
                        <td
                          style={{ position: "sticky", left: COL_NO + COL_ID, background: "#fff", zIndex: 1 }}
                        >
                          <span
                            title={displayName}
                            style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          >
                            {displayName}
                          </span>
                        </td>

                        {uniqueDates.map((d, i) => {
                          const isLatest = d === latestDate;
                          let value: number | null = null;
                          if (isLatest) {
                            const sc = product.nmId !== null ? stockCounts.get(product.nmId) : undefined;
                            value = sc !== undefined ? sc : null;
                          } else {
                            const dateIdx = matrix.dates.indexOf(d);
                            value = matrixRow && dateIdx >= 0 ? matrixRow.values[dateIdx] : null;
                          }
                          return (
                            <td
                              key={d}
                              className="wb-table-cell--numeric"
                              style={{
                                fontWeight: value != null ? 600 : undefined,
                                ...(isLatest
                                  ? { position: "sticky", left: COL_NO + COL_ID + COL_NAME, background: "#fff", zIndex: 1, borderRight: "2px solid var(--wb-gold-mid)" }
                                  : {}),
                              }}
                            >
                              <span style={value == null ? { opacity: 0.3 } : undefined}>
                                {value != null ? String(value) : "—"}
                              </span>
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
