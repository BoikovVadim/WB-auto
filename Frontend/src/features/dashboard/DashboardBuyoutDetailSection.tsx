import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchBuyoutSnapshotMatrix,
  type BuyoutSnapshotMatrix,
  type TodayBuyoutCount,
} from "../../api/syncClientBuyouts";
import { formatPercent, formatDateWithWeekday } from "../../formatters";
import type { ProductListItem } from "./useDashboardProductsWorkspace";
import {
  VirtualMatrixTable,
  type CellContent,
  type DateColumn,
} from "./VirtualMatrixTable";

type Props = {
  products: ProductListItem[];
  /**
   * Rolling 365-day snapshot per product (orders + buyouts) — identical to the
   * data the inline «% выкупа» column in the catalog shows. Used as the
   * «сегодня» column in the retrospective.
   */
  rollingBuyoutCounts: Map<number, TodayBuyoutCount>;
  onBack: () => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type BuyoutMatrix = {
  dates: string[];
  products: {
    nmId: number;
    percents: (number | null)[];
    orders: number[];
    buyouts: number[];
  }[];
};

const CACHE_KEY = "wb_buyout_snapshot_matrix_v2";
const CACHE_DATE = "wb_buyout_snapshot_matrix_v2_date";

function readCache(): BuyoutMatrix | null {
  try {
    const savedDate = localStorage.getItem(CACHE_DATE);
    if (savedDate !== todayIso()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as BuyoutMatrix) : null;
  } catch {
    return null;
  }
}

function writeCache(m: BuyoutMatrix) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(CACHE_DATE, todayIso());
  } catch {
    /* quota */
  }
}

function fromServer(m: BuyoutSnapshotMatrix): BuyoutMatrix {
  return {
    dates: m.dates,
    products: m.products.map((p) => ({
      nmId: p.nmId,
      percents: p.percents,
      orders: p.orders,
      buyouts: p.buyouts,
    })),
  };
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

export function DashboardBuyoutDetailSection({
  products,
  rollingBuyoutCounts,
  onBack,
}: Props) {
  const today = todayIso();

  const [colNo, setColNo] = useState(48);
  const [colId, setColId] = useState(110);
  const [colName, setColName] = useState(220);
  const [colDate, setColDate] = useState(130);

  const [matrix, setMatrix] = useState<BuyoutMatrix>(
    () => readCache() ?? { dates: [], products: [] },
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
    fetchBuyoutSnapshotMatrix()
      .then((m) => {
        const local = fromServer(m);
        setMatrix(local);
        writeCache(local);
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

  // Past dates = all snapshot dates excluding today (no pagination — virtualization handles it)
  const pastDates = useMemo(
    () => matrix.dates.filter((d) => d !== today),
    [matrix.dates, today],
  );

  const getPercent = useCallback(
    (nmId: number | null, dateIso: string): number | null => {
      if (nmId === null) return null;
      if (dateIso === today) {
        const e = rollingBuyoutCounts.get(nmId);
        // Нет заказов ИЛИ нет выкупов → «нет данных» (—), а не 0 %.
        if (!e || e.ordersCount === 0 || e.buyoutsCount === 0) return null;
        return (e.buyoutsCount / e.ordersCount) * 100;
      }
      const row = matrixByNmId.get(nmId);
      const idx = matrixIdxByDate.get(dateIso);
      return row && idx != null ? (row.percents[idx] ?? null) : null;
    },
    [today, rollingBuyoutCounts, matrixByNmId, matrixIdxByDate],
  );

  // Counts (orders, buyouts) по ячейке — для взвешенного «Итого».
  // Возвращает null, если данных за выкуп нет (выкупов 0) — такие ячейки в
  // «Итого» не участвуют, ровно как и в отображении (там стоит «—»).
  const getCounts = useCallback(
    (nmId: number | null, dateIso: string): { orders: number; buyouts: number } | null => {
      if (nmId === null) return null;
      if (dateIso === today) {
        const e = rollingBuyoutCounts.get(nmId);
        if (!e || e.ordersCount === 0 || e.buyoutsCount === 0) return null;
        return { orders: e.ordersCount, buyouts: e.buyoutsCount };
      }
      const row = matrixByNmId.get(nmId);
      const idx = matrixIdxByDate.get(dateIso);
      if (!row || idx == null) return null;
      if (row.percents[idx] == null) return null; // нет данных за выкуп
      return { orders: row.orders[idx] ?? 0, buyouts: row.buyouts[idx] ?? 0 };
    },
    [today, rollingBuyoutCounts, matrixByNmId, matrixIdxByDate],
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
      const av = getPercent(a.nmId, sortCol) ?? -1;
      const bv = getPercent(b.nmId, sortCol) ?? -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [products, sortCol, sortDir, getPercent]);

  // Totals для ВСЕХ колонок считаются одинаково — ВЗВЕШЕННО: Σвыкупов/Σзаказов
  // по товарам, у которых за этот день есть данные. Простое среднее процентов
  // (как было для прошлых дней) расходилось с «сегодня» на ~2 %, т.к. не учитывало
  // объём: мелкий товар с низким выкупом весил столько же, сколько крупный.
  // index 0 = today, index 1+ = pastDates[i-1].
  const dateTotals = useMemo(() => {
    const weightedFor = (dateIso: string): number | null => {
      let orders = 0;
      let buyouts = 0;
      for (const p of products) {
        const c = getCounts(p.nmId, dateIso);
        if (!c) continue;
        orders += c.orders;
        buyouts += c.buyouts;
      }
      return orders > 0 ? (buyouts / orders) * 100 : null;
    };
    return [today, ...pastDates].map(weightedFor);
  }, [today, pastDates, products, getCounts]);

  const pinnedCol: DateColumn = useMemo(
    () => ({
      key: today,
      headerLabel: formatDateWithWeekday(today),
      onHeaderClick: () => {
        handleSortToggle(today);
      },
      sortIndicator: <SortArrow active={sortCol === today} dir={sortDir} />,
      totalDisplay: formatPercent(dateTotals[0] ?? null),
      accent: true,
    }),
    [today, dateTotals, sortCol, sortDir, handleSortToggle],
  );

  const dataCols: DateColumn[] = useMemo(
    () =>
      pastDates.map((d, i) => ({
        key: d,
        headerLabel: formatDateWithWeekday(d),
        onHeaderClick: () => {
          handleSortToggle(d);
        },
        sortIndicator: <SortArrow active={sortCol === d} dir={sortDir} />,
        totalDisplay: formatPercent(dateTotals[i + 1] ?? null),
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
      const p = sortedProducts[rowIdx];
      if (!p) return EMPTY_CELL;
      return pctCell(getPercent(p.nmId, today));
    },
    [sortedProducts, getPercent, today],
  );

  const getCell = useCallback(
    (rowIdx: number, dataColIdx: number): CellContent => {
      const p = sortedProducts[rowIdx];
      if (!p) return EMPTY_CELL;
      const d = pastDates[dataColIdx];
      if (d == null) return EMPTY_CELL;
      return pctCell(getPercent(p.nmId, d));
    },
    [sortedProducts, pastDates, getPercent],
  );

  const toolbar = loading ? (
    <span style={{ fontSize: 12, color: "var(--wb-text-muted)" }}>Обновление…</span>
  ) : null;

  const empty =
    products.length === 0 ? (
      <p className="wb-empty-copy" style={{ padding: "32px" }}>
        Нет товаров.
      </p>
    ) : null;

  return (
    <VirtualMatrixTable
      title="% выкупа"
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
