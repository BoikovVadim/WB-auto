import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchOrdersMatrix, type OrdersMatrixRow, type TodayOrderCount } from "../../api/syncClientOrders";
import type { ProductListItem } from "./useDashboardProductsWorkspace";

type Props = {
  products: ProductListItem[];
  /** Today's order counts — same data shown in the Products tab */
  orderCounts: Map<number, TodayOrderCount>;
  onBack: () => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day ?? ""}.${month ?? ""}.${year ?? ""}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type OrdersMatrix = { dates: string[]; products: { nmId: number; values: (number | null)[] }[] };

const ORDERS_MATRIX_CACHE_KEY    = "wb_orders_matrix_v2";
const ORDERS_MATRIX_CACHE_DATE   = "wb_orders_matrix_v2_date";

function readMatrixCache(): OrdersMatrix | null {
  try {
    // Invalidate cache when the calendar date changes (day boundary).
    const savedDate = localStorage.getItem(ORDERS_MATRIX_CACHE_DATE);
    if (savedDate !== todayIso()) return null;
    const raw = localStorage.getItem(ORDERS_MATRIX_CACHE_KEY);
    return raw ? (JSON.parse(raw) as OrdersMatrix) : null;
  } catch {
    return null;
  }
}

function writeMatrixCache(m: OrdersMatrix) {
  try {
    localStorage.setItem(ORDERS_MATRIX_CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(ORDERS_MATRIX_CACHE_DATE, todayIso());
  } catch { /* quota */ }
}

function buildMatrix(rows: OrdersMatrixRow[]): OrdersMatrix {
  const datesSet = new Set<string>();
  for (const r of rows) datesSet.add(r.orderDate);
  // Newest first, excluding today (today comes from live orderCounts)
  const today = todayIso();
  const dates = Array.from(datesSet)
    .filter((d) => d !== today)
    .sort((a, b) => (a < b ? 1 : -1));
  const byNmId = new Map<number, Map<string, number>>();
  for (const r of rows) {
    if (r.orderDate === today) continue;
    if (!byNmId.has(r.nmId)) byNmId.set(r.nmId, new Map());
    byNmId.get(r.nmId)!.set(r.orderDate, r.ordersCount);
  }
  const products = Array.from(byNmId.entries()).map(([nmId, dateMap]) => ({
    nmId,
    values: dates.map((d) => dateMap.get(d) ?? null),
  }));
  return { dates, products };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function DashboardOrdersDetailSection({ products, orderCounts, onBack }: Props) {
  const tableRef = useRef<HTMLTableElement | null>(null);
  const resizingColRef = useRef<number | null>(null);

  const today = todayIso();

  const [matrix, setMatrix] = useState<OrdersMatrix>(() => readMatrixCache() ?? { dates: [], products: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchOrdersMatrix()
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

  // Today is always first column; historical dates follow
  const uniqueDates = useMemo(() => {
    const result: string[] = [today];
    for (const d of matrix.dates) {
      if (d !== today) result.push(d);
    }
    return result;
  }, [matrix.dates, today]);

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

  const COL_NO = 48;
  const COL_ID = 110;
  const COL_NAME = 220;
  const COL_DATE = 130;

  const totalFixedW = COL_NO + COL_ID + COL_NAME + COL_DATE * uniqueDates.length;

  // Column totals: sum of ordersCount per date across all products
  const dateTotals = useMemo(() => {
    return uniqueDates.map((d) => {
      const isToday = d === today;
      let total = 0;
      for (const product of products) {
        if (product.nmId === null) continue;
        if (isToday) {
          const oc = orderCounts.get(product.nmId);
          total += oc ? oc.ordersCount : 0;
        } else {
          const matrixRow = matrixByNmId.get(product.nmId);
          const dateIdx = matrix.dates.indexOf(d);
          total += matrixRow && dateIdx >= 0 ? (matrixRow.values[dateIdx] ?? 0) : 0;
        }
      }
      return total;
    });
  }, [uniqueDates, today, products, orderCounts, matrixByNmId, matrix.dates]);

  return (
    <section className="wb-card wb-card--wide">
      <div className="wb-workspace-header wb-workspace-header--products-detail">
        <h2>Заказы</h2>
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
                      const isToday = d === today;
                      const stickyLeft = isToday ? COL_NO + COL_ID + COL_NAME : undefined;
                      return (
                        <th
                          key={d}
                          className="wb-table-cell--numeric"
                          style={{
                            width: COL_DATE,
                            zIndex: isToday ? 4 : 2,
                            ...(isToday
                              ? { position: "sticky", left: stickyLeft, background: "#fbf7eb", borderRight: "2px solid var(--wb-gold-mid)" }
                              : {}),
                          }}
                        >
                          <span style={isToday ? { color: "var(--wb-gold-dark)", fontWeight: 800 } : {}}>
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
                      const isToday = d === today;
                      const total = dateTotals[i] ?? 0;
                      return (
                        <th
                          key={d}
                          className="wb-table-cell--numeric"
                          style={{
                            position: "sticky", top: 26,
                            background: "var(--wb-table-totals-bg)",
                            zIndex: isToday ? 4 : 2,
                            ...(isToday
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
                          const isToday = d === today;
                          let value: number | null = null;
                          if (isToday) {
                            const oc = product.nmId !== null ? orderCounts.get(product.nmId) : undefined;
                            value = oc ? oc.ordersCount : null;
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
                                ...(isToday
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
