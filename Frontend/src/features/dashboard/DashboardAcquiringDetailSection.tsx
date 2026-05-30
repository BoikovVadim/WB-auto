import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchAcquiringMatrix, type AcquiringMatrix } from "../../api/syncClientUnitEconomics";
import { formatPercent } from "../../formatters";
import type { ProductListItem } from "./useDashboardProductsWorkspace";
import {
  VirtualMatrixTable,
  type CellContent,
  type DateColumn,
} from "./VirtualMatrixTable";

type Props = {
  products: ProductListItem[];
  onBack: () => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "2026-05-18" + "2026-05-24" → "18.05–24.05". */
function weekLabel(start: string, end: string): string {
  const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  return `${dm(start)}–${dm(end)}`;
}

const CACHE_KEY = "wb_acquiring_matrix_v1";
const CACHE_DATE = "wb_acquiring_matrix_v1_date";

function readCache(): AcquiringMatrix | null {
  try {
    if (localStorage.getItem(CACHE_DATE) !== todayIso()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as AcquiringMatrix) : null;
  } catch {
    return null;
  }
}

function writeCache(m: AcquiringMatrix) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(CACHE_DATE, todayIso());
  } catch {
    /* quota */
  }
}

type SortCol = string | null;

function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span style={{ opacity: active ? 1 : 0.3, fontSize: 11 }}>
      {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );
}

const EMPTY_CELL: CellContent = {
  display: <span style={{ opacity: 0.3 }}>—</span>,
  copy: "",
};

function pctCell(value: number | null): CellContent {
  if (value == null) return EMPTY_CELL;
  return { display: formatPercent(value), copy: value.toFixed(2) };
}

/** Фоновый прогрев кэша матрицы эквайринга (best-effort) — лист открывается мгновенно. */
export async function prefetchAcquiringMatrix(): Promise<void> {
  try {
    writeCache(await fetchAcquiringMatrix());
  } catch {
    /* best-effort */
  }
}

export function DashboardAcquiringDetailSection({ products, onBack }: Props) {
  const [colNo, setColNo] = useState(48);
  const [colId, setColId] = useState(110);
  const [colName, setColName] = useState(220);
  const [colWeek, setColWeek] = useState(120);

  const [matrix, setMatrix] = useState<AcquiringMatrix>(
    () => readCache() ?? { weeks: [], products: [] },
  );
  const [loading, setLoading] = useState(false);

  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSortToggle = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return col;
      }
      setSortDir("desc");
      return col;
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchAcquiringMatrix()
      .then((m) => {
        setMatrix(m);
        writeCache(m);
      })
      .catch(() => {
        /* keep cached */
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const matrixByNmId = useMemo(
    () => new Map(matrix.products.map((p) => [p.nmId, p])),
    [matrix.products],
  );
  const weekIdxByStart = useMemo(() => {
    const m = new Map<string, number>();
    matrix.weeks.forEach((w, i) => m.set(w.start, i));
    return m;
  }, [matrix.weeks]);

  // Последняя закрытая неделя (если есть) — pinned-колонка с акцентом (= inline-колонка
  // «Эквайринг, %»); остальные недели — от свежих к старым.
  const latestWeek = matrix.weeks.length > 0 ? matrix.weeks[matrix.weeks.length - 1]! : null;
  const pastWeeks = useMemo(
    () => (latestWeek ? matrix.weeks.slice(0, -1).slice().reverse() : []),
    [matrix.weeks, latestWeek],
  );

  const getPercent = useCallback(
    (nmId: number | null, weekStart: string): number | null => {
      if (nmId === null) return null;
      const row = matrixByNmId.get(nmId);
      const idx = weekIdxByStart.get(weekStart);
      return row && idx != null ? (row.percents[idx] ?? null) : null;
    },
    [matrixByNmId, weekIdxByStart],
  );

  // Σfee / Σretail по ячейке — для взвешенного «Итого» по столбцу-неделе.
  const getFeeRetail = useCallback(
    (nmId: number | null, weekStart: string): { fee: number; retail: number } | null => {
      if (nmId === null) return null;
      const row = matrixByNmId.get(nmId);
      const idx = weekIdxByStart.get(weekStart);
      if (!row || idx == null || row.percents[idx] == null) return null;
      return { fee: row.fees[idx] ?? 0, retail: row.retails[idx] ?? 0 };
    },
    [matrixByNmId, weekIdxByStart],
  );

  const sortedProducts = useMemo(() => {
    if (!sortCol) return products;
    return [...products].sort((a, b) => {
      if (sortCol === "nmId") {
        return sortDir === "asc" ? (a.nmId ?? 0) - (b.nmId ?? 0) : (b.nmId ?? 0) - (a.nmId ?? 0);
      }
      if (sortCol === "vendorCode") {
        const av = a.vendorCode ?? "";
        const bv = b.vendorCode ?? "";
        return sortDir === "asc" ? av.localeCompare(bv, "ru") : bv.localeCompare(av, "ru");
      }
      const av = getPercent(a.nmId, sortCol) ?? -1;
      const bv = getPercent(b.nmId, sortCol) ?? -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [products, sortCol, sortDir, getPercent]);

  // Взвешенный «Итого» по неделе: Σfee / Σretail × 100 (по товарам с данными).
  const weekTotals = useMemo(() => {
    const weightedFor = (weekStart: string): number | null => {
      let fee = 0;
      let retail = 0;
      for (const p of products) {
        const c = getFeeRetail(p.nmId, weekStart);
        if (!c) continue;
        fee += c.fee;
        retail += c.retail;
      }
      return retail > 0 ? (fee / retail) * 100 : null;
    };
    const totals = new Map<string, number | null>();
    for (const w of matrix.weeks) totals.set(w.start, weightedFor(w.start));
    return totals;
  }, [matrix.weeks, products, getFeeRetail]);

  const pinnedCol: DateColumn | undefined = useMemo(() => {
    if (!latestWeek) return undefined;
    return {
      key: latestWeek.start,
      headerLabel: weekLabel(latestWeek.start, latestWeek.end),
      onHeaderClick: () => handleSortToggle(latestWeek.start),
      sortIndicator: <SortArrow active={sortCol === latestWeek.start} dir={sortDir} />,
      totalDisplay: formatPercent(weekTotals.get(latestWeek.start) ?? null),
      accent: true,
    };
  }, [latestWeek, weekTotals, sortCol, sortDir, handleSortToggle]);

  const dataCols: DateColumn[] = useMemo(
    () =>
      pastWeeks.map((w) => ({
        key: w.start,
        headerLabel: weekLabel(w.start, w.end),
        onHeaderClick: () => handleSortToggle(w.start),
        sortIndicator: <SortArrow active={sortCol === w.start} dir={sortDir} />,
        totalDisplay: formatPercent(weekTotals.get(w.start) ?? null),
      })),
    [pastWeeks, weekTotals, sortCol, sortDir, handleSortToggle],
  );

  const getRowKey = useCallback(
    (rowIdx: number) => {
      const p = sortedProducts[rowIdx];
      return p ? `${p.vendorCode}-${p.nmId ?? "none"}` : String(rowIdx);
    },
    [sortedProducts],
  );

  const getLeftLeading = useCallback(
    (rowIdx: number) => {
      const p = sortedProducts[rowIdx];
      if (!p) {
        return {
          no: { display: String(rowIdx + 1), copy: String(rowIdx + 1) },
          id: EMPTY_CELL,
          name: EMPTY_CELL,
        };
      }
      const displayName =
        p.vendorCode !== "" ? p.vendorCode : p.nmId !== null ? `#${String(p.nmId)}` : "—";
      return {
        no: { display: String(rowIdx + 1), copy: String(rowIdx + 1) },
        id: {
          display: p.nmId !== null ? String(p.nmId) : "—",
          copy: p.nmId !== null ? String(p.nmId) : "",
        },
        name: { display: <span title={displayName}>{displayName}</span>, copy: displayName },
      };
    },
    [sortedProducts],
  );

  const getPinnedCell = useCallback(
    (rowIdx: number): CellContent => {
      const p = sortedProducts[rowIdx];
      if (!p || !latestWeek) return EMPTY_CELL;
      return pctCell(getPercent(p.nmId, latestWeek.start));
    },
    [sortedProducts, getPercent, latestWeek],
  );

  const getCell = useCallback(
    (rowIdx: number, dataColIdx: number): CellContent => {
      const p = sortedProducts[rowIdx];
      const w = pastWeeks[dataColIdx];
      if (!p || w == null) return EMPTY_CELL;
      return pctCell(getPercent(p.nmId, w.start));
    },
    [sortedProducts, pastWeeks, getPercent],
  );

  const toolbar = loading ? (
    <span style={{ fontSize: 12, color: "var(--wb-text-muted)" }}>Обновление…</span>
  ) : null;

  const empty =
    products.length === 0 ? (
      <p className="wb-empty-copy" style={{ padding: "32px" }}>
        Нет товаров.
      </p>
    ) : matrix.weeks.length === 0 && !loading ? (
      <p className="wb-empty-copy" style={{ padding: "32px" }}>
        Нет данных по эквайрингу. Отчёт о реализации синкается раз в сутки (05:07 МСК).
      </p>
    ) : null;

  return (
    <VirtualMatrixTable
      title="Эквайринг, %"
      toolbar={toolbar}
      onBack={onBack}
      empty={empty}
      rowCount={sortedProducts.length}
      getRowKey={getRowKey}
      getLeftLeading={getLeftLeading}
      noCol={{ width: colNo, setWidth: setColNo, minWidth: 36 }}
      idCol={{
        width: colId,
        setWidth: setColId,
        minWidth: 60,
        headerLabel: "ID товара",
        onHeaderClick: () => handleSortToggle("nmId"),
        sortIndicator: <SortArrow active={sortCol === "nmId"} dir={sortDir} />,
      }}
      nameCol={{
        width: colName,
        setWidth: setColName,
        minWidth: 80,
        headerLabel: "Название товара",
        onHeaderClick: () => handleSortToggle("vendorCode"),
        sortIndicator: <SortArrow active={sortCol === "vendorCode"} dir={sortDir} />,
      }}
      pinnedCol={pinnedCol}
      getPinnedCell={getPinnedCell}
      dataCols={dataCols}
      dataColWidth={colWeek}
      setDataColWidth={setColWeek}
      dataColMinWidth={60}
      getCell={getCell}
      hasTotalsRow
    />
  );
}
