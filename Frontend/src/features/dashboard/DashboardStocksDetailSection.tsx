import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateWithWeekday } from "../../formatters";

import { fetchStocksMatrix, type StocksMatrixRow } from "../../api/syncClientStocks";
import type { ProductListItem } from "./useDashboardProductsWorkspace";
import {
  VirtualMatrixTable,
  type CellContent,
  type DateColumn,
} from "./VirtualMatrixTable";

type Props = {
  products: ProductListItem[];
  /** Latest stock quantities — same data shown in the Products tab */
  stockCounts: Map<number, number>;
  onBack: () => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type StocksMatrix = { dates: string[]; products: { nmId: number; values: (number | null)[] }[] };

const STOCKS_MATRIX_CACHE_KEY = "wb_stocks_matrix_v1";
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
  } catch {
    /* quota */
  }
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

function numCell(value: number | null): CellContent {
  if (value == null) return EMPTY_CELL;
  return { display: String(value), copy: String(value) };
}

export function DashboardStocksDetailSection({ products, stockCounts, onBack }: Props) {
  const today = todayIso();

  const [colNo, setColNo] = useState(48);
  const [colId, setColId] = useState(110);
  const [colName, setColName] = useState(220);
  const [colDate, setColDate] = useState(130);

  const [matrix, setMatrix] = useState<StocksMatrix>(
    () => readMatrixCache() ?? { dates: [], products: [] },
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
    fetchStocksMatrix()
      .then((rows) => {
        const m = buildMatrix(rows);
        setMatrix(m);
        writeMatrixCache(m);
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

  const matrixIdxByDate = useMemo(() => {
    const m = new Map<string, number>();
    matrix.dates.forEach((d, i) => m.set(d, i));
    return m;
  }, [matrix.dates]);

  // Активный (закреплённый) столбец = «Сегодня» — живой остаток из stockCounts.
  // Прошлые колонки — замороженные снапшоты прошлых дней; они копятся вечно (строки
  // в wb_product_daily_stocks только добавляются). Сегодня НЕ дублируем в прошлых:
  // оно всегда в закреплённой колонке. Если живых данных ещё нет — закрепляем самый
  // свежий снапшот, чтобы лист не был пустым.
  const hasLive = stockCounts.size > 0;
  const latestSnapshotDate = matrix.dates[0] ?? null;
  const pinnedKey = hasLive ? today : latestSnapshotDate;

  const pastDates = useMemo(
    () => matrix.dates.filter((d) => d !== today && d !== pinnedKey),
    [matrix.dates, today, pinnedKey],
  );

  const getStockValue = useCallback(
    (nmId: number | null, d: string | null): number | null => {
      if (nmId === null || d === null) return null;
      if (d === today) return stockCounts.get(nmId) ?? null;
      const row = matrixByNmId.get(nmId);
      const idx = matrixIdxByDate.get(d);
      return row && idx != null ? (row.values[idx] ?? null) : null;
    },
    [today, stockCounts, matrixByNmId, matrixIdxByDate],
  );

  const sortedProducts = useMemo(() => {
    if (!sortCol) return products;
    return [...products].sort((a, b) => {
      if (sortCol === "nmId") {
        const av = a.nmId ?? 0;
        const bv = b.nmId ?? 0;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      if (sortCol === "vendorCode") {
        const av = a.vendorCode ?? "";
        const bv = b.vendorCode ?? "";
        return sortDir === "asc"
          ? av.localeCompare(bv, "ru")
          : bv.localeCompare(av, "ru");
      }
      const av = getStockValue(a.nmId, sortCol) ?? -1;
      const bv = getStockValue(b.nmId, sortCol) ?? -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [products, sortCol, sortDir, getStockValue]);

  // Итого по столбцу = сумма остатков по товарам, у кого есть данные за этот день.
  // index 0 = закреплённый (pinnedKey), index 1+ = pastDates[i-1].
  const dateTotals = useMemo(() => {
    const sumFor = (d: string | null): number => {
      if (!d) return 0;
      let total = 0;
      for (const p of products) {
        const v = getStockValue(p.nmId, d);
        if (v != null) total += v;
      }
      return total;
    };
    return [pinnedKey, ...pastDates].map(sumFor);
  }, [pinnedKey, pastDates, products, getStockValue]);

  const pinnedCol: DateColumn | undefined = useMemo(() => {
    if (!pinnedKey) return undefined;
    const label = formatDateWithWeekday(pinnedKey);
    return {
      key: pinnedKey,
      headerLabel: label,
      onHeaderClick: () => {
        handleSortToggle(pinnedKey);
      },
      sortIndicator: <SortArrow active={sortCol === pinnedKey} dir={sortDir} />,
      totalDisplay: dateTotals[0] > 0 ? String(dateTotals[0]) : "—",
      accent: true,
    };
  }, [pinnedKey, dateTotals, sortCol, sortDir, handleSortToggle]);

  const dataCols: DateColumn[] = useMemo(
    () =>
      pastDates.map((d, i) => ({
        key: d,
        headerLabel: formatDateWithWeekday(d),
        onHeaderClick: () => {
          handleSortToggle(d);
        },
        sortIndicator: <SortArrow active={sortCol === d} dir={sortDir} />,
        totalDisplay: (dateTotals[i + 1] ?? 0) > 0 ? String(dateTotals[i + 1]) : "—",
      })),
    [pastDates, dateTotals, sortCol, sortDir, handleSortToggle],
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
        p.vendorCode !== ""
          ? p.vendorCode
          : p.nmId !== null
            ? `#${String(p.nmId)}`
            : "—";
      return {
        no: { display: String(rowIdx + 1), copy: String(rowIdx + 1) },
        id: {
          display: p.nmId !== null ? String(p.nmId) : "—",
          copy: p.nmId !== null ? String(p.nmId) : "",
        },
        name: {
          display: <span title={displayName}>{displayName}</span>,
          copy: displayName,
        },
      };
    },
    [sortedProducts],
  );

  const getPinnedCell = useCallback(
    (rowIdx: number): CellContent => {
      if (!pinnedKey) return EMPTY_CELL;
      const p = sortedProducts[rowIdx];
      if (!p) return EMPTY_CELL;
      return numCell(getStockValue(p.nmId, pinnedKey));
    },
    [sortedProducts, getStockValue, pinnedKey],
  );

  const getCell = useCallback(
    (rowIdx: number, dataColIdx: number): CellContent => {
      const p = sortedProducts[rowIdx];
      if (!p) return EMPTY_CELL;
      const d = pastDates[dataColIdx];
      if (d == null) return EMPTY_CELL;
      return numCell(getStockValue(p.nmId, d));
    },
    [sortedProducts, pastDates, getStockValue],
  );

  const toolbar = loading ? (
    <span style={{ fontSize: 12, color: "var(--wb-text-muted)" }}>Обновление…</span>
  ) : null;

  const empty =
    products.length === 0 ? (
      <p className="wb-empty-copy" style={{ padding: "32px" }}>
        Нет товаров.
      </p>
    ) : !pinnedKey && !loading ? (
      <p className="wb-empty-copy" style={{ padding: "32px" }}>
        Нет данных. Снимок остатков снимается раз в сутки и копит историю вперёд —
        у WB нет архива остатков, только текущий баланс.
      </p>
    ) : null;

  return (
    <VirtualMatrixTable
      title="Остатки"
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
        onHeaderClick: () => {
          handleSortToggle("nmId");
        },
        sortIndicator: <SortArrow active={sortCol === "nmId"} dir={sortDir} />,
      }}
      nameCol={{
        width: colName,
        setWidth: setColName,
        minWidth: 80,
        headerLabel: "Название товара",
        onHeaderClick: () => {
          handleSortToggle("vendorCode");
        },
        sortIndicator: <SortArrow active={sortCol === "vendorCode"} dir={sortDir} />,
      }}
      pinnedCol={pinnedCol}
      getPinnedCell={getPinnedCell}
      dataCols={dataCols}
      dataColWidth={colDate}
      setDataColWidth={setColDate}
      dataColMinWidth={60}
      getCell={getCell}
      hasTotalsRow
    />
  );
}
