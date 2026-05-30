import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchMarginMatrix, type MarginMatrix } from "../../api/syncClientUnitEconomics";
import { formatMoney, formatPercent, formatDateWithWeekday } from "../../formatters";
import { SortArrow } from "./ProductsTableCells";
import type { ProductListItem } from "./useDashboardProductsWorkspace";
import {
  VirtualMatrixTable,
  type CellContent,
  type DateColumn,
} from "./VirtualMatrixTable";

type Mode = "rub" | "percent";

type Props = {
  products: ProductListItem[];
  /** "rub" — лист «Маржа, ₽»; "percent" — «Маржа, %». Данные одни (общая матрица). */
  mode: Mode;
  onBack: () => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Кэш общий для обоих режимов — матрица одна (₽ и % считаются из неё же).
const CACHE_KEY = "wb_margin_matrix_v1";
const CACHE_DATE = "wb_margin_matrix_v1_date";

const EMPTY_MATRIX: MarginMatrix = { today: "", dates: [], products: [] };

function readCache(): MarginMatrix | null {
  try {
    if (localStorage.getItem(CACHE_DATE) !== todayIso()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as MarginMatrix) : null;
  } catch {
    return null;
  }
}

function writeCache(m: MarginMatrix) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(CACHE_DATE, todayIso());
  } catch {
    /* quota */
  }
}

const EMPTY_CELL: CellContent = {
  display: <span style={{ opacity: 0.3 }}>—</span>,
  copy: "",
};

// 0 и отрицательные значения маржи валидны — пустая ячейка только при null.
function rubCell(value: number | null): CellContent {
  if (value == null) return EMPTY_CELL;
  return { display: formatMoney(value), copy: value.toFixed(2) };
}

function pctCell(value: number | null): CellContent {
  if (value == null) return EMPTY_CELL;
  return { display: formatPercent(value), copy: value.toFixed(2) };
}

type SortCol = string | null;

/** Фоновый прогрев кэша матрицы маржи (best-effort) — лист открывается мгновенно. */
export async function prefetchMarginMatrix(): Promise<void> {
  try {
    writeCache(await fetchMarginMatrix());
  } catch {
    /* best-effort */
  }
}

export function DashboardMarginDetailSection({ products, mode, onBack }: Props) {
  const [colNo, setColNo] = useState(48);
  const [colId, setColId] = useState(110);
  const [colName, setColName] = useState(220);
  const [colDate, setColDate] = useState(140);

  const [matrix, setMatrix] = useState<MarginMatrix>(() => readCache() ?? EMPTY_MATRIX);
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
    fetchMarginMatrix()
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

  const rowByNmId = useMemo(
    () => new Map(matrix.products.map((p) => [p.nmId, p])),
    [matrix.products],
  );
  const dateIdx = useMemo(() => {
    const m = new Map<string, number>();
    matrix.dates.forEach((d, i) => m.set(d, i));
    return m;
  }, [matrix.dates]);

  const getRub = useCallback(
    (nmId: number | null, date: string): number | null => {
      if (nmId === null) return null;
      const row = rowByNmId.get(nmId);
      const i = dateIdx.get(date);
      return row && i != null ? (row.marginRub[i] ?? null) : null;
    },
    [rowByNmId, dateIdx],
  );
  const getPercent = useCallback(
    (nmId: number | null, date: string): number | null => {
      if (nmId === null) return null;
      const row = rowByNmId.get(nmId);
      const i = dateIdx.get(date);
      return row && i != null ? (row.marginPercent[i] ?? null) : null;
    },
    [rowByNmId, dateIdx],
  );
  const getPrice = useCallback(
    (nmId: number | null, date: string): number | null => {
      if (nmId === null) return null;
      const row = rowByNmId.get(nmId);
      const i = dateIdx.get(date);
      return row && i != null ? (row.priceWithDiscount[i] ?? null) : null;
    },
    [rowByNmId, dateIdx],
  );

  const getValue = useMemo(
    () => (mode === "rub" ? getRub : getPercent),
    [mode, getRub, getPercent],
  );

  // dates[0] = сегодня (live), остальные — закрытые дни снапшота.
  const today = matrix.today;
  const pastDates = useMemo(() => matrix.dates.filter((d) => d !== today), [matrix.dates, today]);

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
      // Маржа бывает отрицательной → «нет данных» = -Infinity (всегда внизу при desc).
      const av = getValue(a.nmId, sortCol) ?? Number.NEGATIVE_INFINITY;
      const bv = getValue(b.nmId, sortCol) ?? Number.NEGATIVE_INFINITY;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [products, sortCol, sortDir, getValue]);

  // «Итого» по столбцу-дате: ₽ — сумма маржи; % — взвешенно Σмаржа₽ / Σцены × 100.
  const totalDisplayFor = useCallback(
    (date: string): string => {
      if (mode === "rub") {
        let sum = 0;
        let any = false;
        for (const p of products) {
          const v = getRub(p.nmId, date);
          if (v != null) {
            sum += v;
            any = true;
          }
        }
        return any ? formatMoney(sum) : "—";
      }
      let marginSum = 0;
      let priceSum = 0;
      for (const p of products) {
        const v = getRub(p.nmId, date);
        const price = getPrice(p.nmId, date);
        if (v != null && price != null && price > 0) {
          marginSum += v;
          priceSum += price;
        }
      }
      return priceSum > 0 ? formatPercent((marginSum / priceSum) * 100) : "—";
    },
    [mode, products, getRub, getPrice],
  );

  const pinnedCol: DateColumn | undefined = useMemo(() => {
    if (!today) return undefined;
    return {
      key: today,
      headerLabel: formatDateWithWeekday(today),
      onHeaderClick: () => handleSortToggle(today),
      sortIndicator: <SortArrow active={sortCol === today} direction={sortDir} />,
      totalDisplay: totalDisplayFor(today),
      accent: true,
    };
  }, [today, sortCol, sortDir, handleSortToggle, totalDisplayFor]);

  const dataCols: DateColumn[] = useMemo(
    () =>
      pastDates.map((d) => ({
        key: d,
        headerLabel: formatDateWithWeekday(d),
        onHeaderClick: () => handleSortToggle(d),
        sortIndicator: <SortArrow active={sortCol === d} direction={sortDir} />,
        totalDisplay: totalDisplayFor(d),
      })),
    [pastDates, sortCol, sortDir, handleSortToggle, totalDisplayFor],
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

  const cellFor = useCallback(
    (value: number | null): CellContent => (mode === "rub" ? rubCell(value) : pctCell(value)),
    [mode],
  );

  const getPinnedCell = useCallback(
    (rowIdx: number): CellContent => {
      const p = sortedProducts[rowIdx];
      if (!p || !today) return EMPTY_CELL;
      return cellFor(getValue(p.nmId, today));
    },
    [sortedProducts, today, getValue, cellFor],
  );

  const getCell = useCallback(
    (rowIdx: number, dataColIdx: number): CellContent => {
      const p = sortedProducts[rowIdx];
      const d = pastDates[dataColIdx];
      if (!p || d == null) return EMPTY_CELL;
      return cellFor(getValue(p.nmId, d));
    },
    [sortedProducts, pastDates, getValue, cellFor],
  );

  const toolbar = loading ? (
    <span style={{ fontSize: 12, color: "var(--wb-text-muted)" }}>Обновление…</span>
  ) : null;

  const empty =
    products.length === 0 ? (
      <p className="wb-empty-copy" style={{ padding: "32px" }}>
        Нет товаров.
      </p>
    ) : matrix.dates.length === 0 && !loading ? (
      <p className="wb-empty-copy" style={{ padding: "32px" }}>
        Нет данных по марже (нужна себестоимость). Ретроспектива копится с момента запуска —
        снапшот раз в сутки (05:30 МСК).
      </p>
    ) : null;

  return (
    <VirtualMatrixTable
      title={mode === "rub" ? "Маржа, ₽" : "Маржа, %"}
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
        sortIndicator: <SortArrow active={sortCol === "nmId"} direction={sortDir} />,
      }}
      nameCol={{
        width: colName,
        setWidth: setColName,
        minWidth: 80,
        headerLabel: "Название товара",
        onHeaderClick: () => handleSortToggle("vendorCode"),
        sortIndicator: <SortArrow active={sortCol === "vendorCode"} direction={sortDir} />,
      }}
      pinnedCol={pinnedCol}
      getPinnedCell={getPinnedCell}
      dataCols={dataCols}
      dataColWidth={colDate}
      setDataColWidth={setColDate}
      dataColMinWidth={70}
      getCell={getCell}
      hasTotalsRow
    />
  );
}
