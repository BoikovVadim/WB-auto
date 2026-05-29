import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchBuyoutSnapshotMatrix,
  type BuyoutSnapshotMatrix,
  type TodayBuyoutCount,
} from "../../api/syncClientBuyouts";
import { formatMoney } from "../../formatters";
import type { OrdersSumMatrix } from "./useOrdersSumMatrix";
import type { ProductListItem } from "./useDashboardProductsWorkspace";
import {
  VirtualMatrixTable,
  type CellContent,
  type DateColumn,
} from "./VirtualMatrixTable";

type Props = {
  products: ProductListItem[];
  /** Today's orders sum (priceWithDisc) per product — same data shown in Products tab. */
  ordersSumValues: Map<number, number>;
  /** Historical orders-sum matrix — preloaded at dashboard bootstrap. */
  ordersSumMatrix: OrdersSumMatrix;
  /** Rolling 365-day buyout counts per product — drives «сегодня» buyout %. */
  rollingBuyoutCounts: Map<number, TodayBuyoutCount>;
  onBack: () => void;
};

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day ?? ""}.${month ?? ""}.${year ?? ""}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Локальная копия матрицы выкупа (тот же снапшот, что в ретроспективе «% выкупа»).
type BuyoutMatrix = {
  dates: string[];
  products: { nmId: number; percents: (number | null)[] }[];
};

const CACHE_KEY = "wb_buyout_snapshot_matrix_v2";
const CACHE_DATE = "wb_buyout_snapshot_matrix_v2_date";

function readBuyoutCache(): BuyoutMatrix | null {
  try {
    if (localStorage.getItem(CACHE_DATE) !== todayIso()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      dates: string[];
      products: { nmId: number; percents: (number | null)[] }[];
    };
    return { dates: parsed.dates, products: parsed.products.map((p) => ({ nmId: p.nmId, percents: p.percents })) };
  } catch {
    return null;
  }
}

function fromServer(m: BuyoutSnapshotMatrix): BuyoutMatrix {
  return {
    dates: m.dates,
    products: m.products.map((p) => ({ nmId: p.nmId, percents: p.percents })),
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

function moneyCell(value: number | null): CellContent {
  if (value == null || value === 0) return EMPTY_CELL;
  return { display: formatMoney(value), copy: value.toFixed(2) };
}

export function DashboardRevenueDetailSection({
  products,
  ordersSumValues,
  ordersSumMatrix,
  rollingBuyoutCounts,
  onBack,
}: Props) {
  const today = todayIso();

  const [colNo, setColNo] = useState(48);
  const [colId, setColId] = useState(110);
  const [colName, setColName] = useState(220);
  const [colDate, setColDate] = useState(140);

  const [buyoutMatrix, setBuyoutMatrix] = useState<BuyoutMatrix>(
    () => readBuyoutCache() ?? { dates: [], products: [] },
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
        setBuyoutMatrix(fromServer(m));
      })
      .catch(() => {
        /* keep cached */
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // ── Index orders-sum matrix ────────────────────────────────────────────────
  const ordersSumByNmId = useMemo(
    () => new Map(ordersSumMatrix.products.map((p) => [p.nmId, p.values])),
    [ordersSumMatrix.products],
  );
  const ordersSumIdxByDate = useMemo(() => {
    const m = new Map<string, number>();
    ordersSumMatrix.dates.forEach((d, i) => m.set(d, i));
    return m;
  }, [ordersSumMatrix.dates]);

  // ── Index buyout matrix ────────────────────────────────────────────────────
  const buyoutByNmId = useMemo(
    () => new Map(buyoutMatrix.products.map((p) => [p.nmId, p.percents])),
    [buyoutMatrix.products],
  );
  const buyoutIdxByDate = useMemo(() => {
    const m = new Map<string, number>();
    buyoutMatrix.dates.forEach((d, i) => m.set(d, i));
    return m;
  }, [buyoutMatrix.dates]);

  // Колонки ретроспективы привязаны к датам матрицы суммы заказов (без выручки
  // нет смысла без суммы заказов). Выкуп за дату берём из снапшот-матрицы выкупа.
  const pastDates = useMemo(
    () => ordersSumMatrix.dates.filter((d) => d !== today),
    [ordersSumMatrix.dates, today],
  );

  // Выручка(товар, дата) = СуммаЗаказов(дата) × %выкупа(дата) / 100.
  // «сегодня» — отдельный источник: ordersSumValues × rolling-выкуп.
  const getRevenue = useCallback(
    (nmId: number | null, dateIso: string): number | null => {
      if (nmId === null) return null;
      if (dateIso === today) {
        const ordersSum = ordersSumValues.get(nmId);
        if (ordersSum === undefined || ordersSum <= 0) return null;
        const b = rollingBuyoutCounts.get(nmId);
        if (!b || b.ordersCount === 0 || b.buyoutsCount === 0) return null;
        const pct = (b.buyoutsCount / b.ordersCount) * 100;
        return (ordersSum * pct) / 100;
      }
      const sumIdx = ordersSumIdxByDate.get(dateIso);
      const sumValues = ordersSumByNmId.get(nmId);
      const ordersSum = sumIdx != null && sumValues ? sumValues[sumIdx] : null;
      if (ordersSum == null || ordersSum <= 0) return null;
      const pctIdx = buyoutIdxByDate.get(dateIso);
      const pctValues = buyoutByNmId.get(nmId);
      const pct = pctIdx != null && pctValues ? pctValues[pctIdx] : null;
      if (pct == null) return null;
      return (ordersSum * pct) / 100;
    },
    [today, ordersSumValues, rollingBuyoutCounts, ordersSumIdxByDate, ordersSumByNmId, buyoutIdxByDate, buyoutByNmId],
  );

  // Totals: index 0 = today, index 1+ = pastDates[i-1].
  const dateTotals = useMemo(() => {
    const sumFor = (dateIso: string): number => {
      let sum = 0;
      for (const p of products) {
        const v = getRevenue(p.nmId, dateIso);
        if (v != null) sum += v;
      }
      return sum;
    };
    return [today, ...pastDates].map(sumFor);
  }, [today, pastDates, products, getRevenue]);

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
      const av = getRevenue(a.nmId, sortCol) ?? -1;
      const bv = getRevenue(b.nmId, sortCol) ?? -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [products, sortCol, sortDir, getRevenue]);

  const pinnedCol: DateColumn = useMemo(
    () => ({
      key: today,
      headerLabel: formatDate(today),
      onHeaderClick: () => {
        handleSortToggle(today);
      },
      sortIndicator: <SortArrow active={sortCol === today} dir={sortDir} />,
      totalDisplay: dateTotals[0]! > 0 ? formatMoney(dateTotals[0]!) : "—",
      accent: true,
    }),
    [today, dateTotals, sortCol, sortDir, handleSortToggle],
  );

  const dataCols: DateColumn[] = useMemo(
    () =>
      pastDates.map((d, i) => ({
        key: d,
        headerLabel: formatDate(d),
        onHeaderClick: () => {
          handleSortToggle(d);
        },
        sortIndicator: <SortArrow active={sortCol === d} dir={sortDir} />,
        totalDisplay: (dateTotals[i + 1] ?? 0) > 0 ? formatMoney(dateTotals[i + 1]!) : "—",
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
      return moneyCell(getRevenue(p.nmId, today));
    },
    [sortedProducts, getRevenue, today],
  );

  const getCell = useCallback(
    (rowIdx: number, dataColIdx: number): CellContent => {
      const p = sortedProducts[rowIdx];
      if (!p) return EMPTY_CELL;
      const d = pastDates[dataColIdx];
      if (d == null) return EMPTY_CELL;
      return moneyCell(getRevenue(p.nmId, d));
    },
    [sortedProducts, pastDates, getRevenue],
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
      title="Выручка"
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
      dataColMinWidth={70}
      getCell={getCell}
      hasTotalsRow
    />
  );
}
