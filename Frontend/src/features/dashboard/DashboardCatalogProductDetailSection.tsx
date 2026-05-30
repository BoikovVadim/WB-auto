import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchCostPriceMatrix,
  type CostPriceCurrent,
  type CostPriceMatrix,
} from "../../api/syncClientCostPrice";
import { formatMoney, formatDateWithWeekday } from "../../formatters";
import type { ProductListItem } from "./useDashboardProductsWorkspace";
import {
  VirtualMatrixTable,
  type CellContent,
  type DateColumn,
} from "./VirtualMatrixTable";

type Props = {
  products: ProductListItem[];
  /** Today's cost prices — same data shown in the Products tab */
  costPrices: Map<number, CostPriceCurrent>;
  onBack: () => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const MATRIX_CACHE_KEY = "wb_cost_price_matrix_v2";
const MATRIX_CACHE_DATE = "wb_cost_price_matrix_v2_date";

function readMatrixCache(): CostPriceMatrix | null {
  try {
    const savedDate = localStorage.getItem(MATRIX_CACHE_DATE);
    if (savedDate !== todayIso()) return null;
    const raw = localStorage.getItem(MATRIX_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CostPriceMatrix) : null;
  } catch {
    return null;
  }
}

function writeMatrixCache(m: CostPriceMatrix) {
  try {
    localStorage.setItem(MATRIX_CACHE_KEY, JSON.stringify(m));
    localStorage.setItem(MATRIX_CACHE_DATE, todayIso());
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

function costCell(value: number | null): CellContent {
  if (value == null) return EMPTY_CELL;
  return { display: formatMoney(value), copy: value.toFixed(2) };
}

/** Фоновый прогрев кэша матрицы себестоимости (best-effort) — лист открывается мгновенно. */
export async function prefetchCostPriceMatrix(): Promise<void> {
  try {
    writeMatrixCache(await fetchCostPriceMatrix());
  } catch {
    /* best-effort */
  }
}

export function DashboardCatalogProductDetailSection({ products, costPrices, onBack }: Props) {
  const today = todayIso();

  const [colNo, setColNo] = useState(48);
  const [colId, setColId] = useState(110);
  const [colName, setColName] = useState(220);
  const [colDate, setColDate] = useState(130);

  const [matrix, setMatrix] = useState<CostPriceMatrix>(
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
    fetchCostPriceMatrix()
      .then((m) => {
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

  // Index lookup uses the matrix's own date order; display order is sorted desc.
  const matrixIdxByDate = useMemo(() => {
    const m = new Map<string, number>();
    matrix.dates.forEach((d, i) => m.set(d, i));
    return m;
  }, [matrix.dates]);

  const sortedDates = useMemo(
    () => [...matrix.dates].sort((a, b) => (a < b ? 1 : -1)),
    [matrix.dates],
  );

  // Pinned column: live "today" cost when available, else the latest snapshot date.
  const hasLive = costPrices.size > 0;
  const latestSnapshotDate = sortedDates[0] ?? null;
  const pinnedKey = hasLive ? today : latestSnapshotDate;
  const pinnedIsLive = hasLive;

  const pastDates = useMemo(() => {
    if (!pinnedKey || pinnedIsLive) return sortedDates;
    return sortedDates.filter((d) => d !== pinnedKey);
  }, [sortedDates, pinnedKey, pinnedIsLive]);

  const getCostValue = useCallback(
    (nmId: number | null, d: string): number | null => {
      if (nmId === null) return null;
      if (d === today) {
        return costPrices.get(nmId)?.costValue ?? null;
      }
      const row = matrixByNmId.get(nmId);
      if (!row) return null;
      const idx = matrixIdxByDate.get(d);
      if (idx == null) return null;
      return row.values[idx] ?? null;
    },
    [today, costPrices, matrixByNmId, matrixIdxByDate],
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
      const av = getCostValue(a.nmId, sortCol) ?? -1;
      const bv = getCostValue(b.nmId, sortCol) ?? -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [products, sortCol, sortDir, getCostValue]);

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
      accent: true,
    };
  }, [pinnedKey, sortCol, sortDir, handleSortToggle]);

  const dataCols: DateColumn[] = useMemo(
    () =>
      pastDates.map((d) => ({
        key: d,
        headerLabel: formatDateWithWeekday(d),
        onHeaderClick: () => {
          handleSortToggle(d);
        },
        sortIndicator: <SortArrow active={sortCol === d} dir={sortDir} />,
      })),
    [pastDates, sortCol, sortDir, handleSortToggle],
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
      return costCell(getCostValue(p.nmId, pinnedKey));
    },
    [sortedProducts, getCostValue, pinnedKey],
  );

  const getCell = useCallback(
    (rowIdx: number, dataColIdx: number): CellContent => {
      const p = sortedProducts[rowIdx];
      if (!p) return EMPTY_CELL;
      const d = pastDates[dataColIdx];
      if (d == null) return EMPTY_CELL;
      return costCell(getCostValue(p.nmId, d));
    },
    [sortedProducts, pastDates, getCostValue],
  );

  const toolbar = loading ? (
    <span style={{ fontSize: 12, color: "var(--wb-text-muted)" }}>Обновление…</span>
  ) : null;

  const empty =
    products.length === 0 ? (
      <p className="wb-empty-copy" style={{ padding: "32px" }}>
        Нет товаров.
      </p>
    ) : !pinnedKey && pastDates.length === 0 && !loading ? (
      <p className="wb-empty-copy" style={{ padding: "32px" }}>
        Нет данных. Себестоимость сохраняется автоматически вместе со снапшотом в 00:01 МСК.
      </p>
    ) : null;

  return (
    <VirtualMatrixTable
      title="Себестоимость"
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
      hasTotalsRow={false}
    />
  );
}
