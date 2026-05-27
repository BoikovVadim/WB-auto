import { useCallback, useEffect, useRef, useState, useMemo } from "react";

import { fetchCostPriceMatrix, type CostPriceMatrix, type CostPriceCurrent } from "../../api/syncClientCostPrice";
import type { ProductListItem } from "./useDashboardProductsWorkspace";

type Props = {
  products: ProductListItem[];
  /** Today's cost prices — same data shown in the Products tab */
  costPrices: Map<number, CostPriceCurrent>;
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

const MATRIX_CACHE_KEY = "wb_cost_price_matrix_v1";

function readMatrixCache(): CostPriceMatrix | null {
  try {
    const raw = localStorage.getItem(MATRIX_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CostPriceMatrix) : null;
  } catch {
    return null;
  }
}

function writeMatrixCache(matrix: CostPriceMatrix) {
  try {
    localStorage.setItem(MATRIX_CACHE_KEY, JSON.stringify(matrix));
  } catch {
    // quota exceeded — not critical
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function DashboardCatalogProductDetailSection({ products, costPrices, onBack }: Props) {
  const tableRef = useRef<HTMLTableElement | null>(null);
  const resizingColRef = useRef<number | null>(null);

  const today = todayIso();

  // Load matrix from cache immediately, then refresh from server
  const [matrix, setMatrix] = useState<CostPriceMatrix>(() => readMatrixCache() ?? { dates: [], products: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchCostPriceMatrix()
      .then((m) => {
        setMatrix(m);
        writeMatrixCache(m);
      })
      .catch(() => {/* keep showing cached data */})
      .finally(() => { setLoading(false); });
  }, []);

  // Build lookup: nmId → matrix product row
  const matrixByNmId = useMemo(
    () => new Map(matrix.products.map((p) => [p.nmId, p])),
    [matrix.products],
  );

  // dates: today is always the first column (data comes from costPrices prop,
  // not the matrix). Historical dates come from the matrix (all < today).
  const uniqueDates = useMemo(() => {
    const result: string[] = [today];
    for (const d of matrix.dates) {
      if (d !== today) result.push(d);
    }
    return result;
  }, [matrix.dates, today]);

  // Min widths per column index
  const minWidths = useMemo(() => {
    const m = new Map<number, number>([[0, 36], [1, 80], [2, 90]]);
    for (let i = 3; i < 3 + uniqueDates.length; i++) m.set(i, 80);
    return m;
  }, [uniqueDates.length]);

  // Resize: same pattern as DashboardCatalogProductsSection
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

      // Snapshot all col widths at drag start
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
        // Update col width
        const col = cols[resizingColRef.current];
        if (col) { col.style.width = `${newWidth}px`; col.style.minWidth = `${newWidth}px`; }
        // Update total table width proportionally
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

  // Fixed column widths
  const COL_NO = 48;
  const COL_ID = 110;
  const COL_NAME = 220;
  const COL_DATE = 130; // each date column

  const totalFixedW = COL_NO + COL_ID + COL_NAME + COL_DATE * uniqueDates.length;

  return (
    <section className="wb-card wb-card--wide">
      <div className="wb-workspace-header wb-workspace-header--products-detail">
        <h2>Себестоимость</h2>
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
                    {/* Fixed columns */}
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

                    {/* Date columns — today is pinned sticky after the name column */}
                    {uniqueDates.map((d, i) => {
                      const isToday = d === today;
                      const stickyLeft = isToday ? COL_NO + COL_ID + COL_NAME : undefined;
                      return (
                        <th
                          key={d}
                          className="wb-table-cell--numeric"
                          style={{
                            width: COL_DATE,
                            ...(isToday
                              ? { position: "sticky", left: stickyLeft, zIndex: 4, background: "#fbf7eb", borderRight: "2px solid var(--wb-gold-mid)" }
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
                            // Today's column: use live costPrices (same as Products tab)
                            const cp = product.nmId !== null ? costPrices.get(product.nmId) : undefined;
                            value = cp ? cp.costValue : null;
                          } else {
                            // Historical: use matrix
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
                                {value != null ? `${value.toLocaleString("ru-RU")} ₽` : "—"}
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
